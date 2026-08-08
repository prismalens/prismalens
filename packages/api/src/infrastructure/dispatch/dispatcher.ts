// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The dispatch loop.
 *
 * A claim-based JobStore polled under a concurrency limit already IS a scheduler, so
 * scheduling here is policy inside this loop rather than a port of its own. There is no
 * `Scheduler` seam, and there will not be one unless a genuinely distributed
 * implementation is built.
 *
 * **Fairness is a global concurrency cap and nothing more.** No fairness key, no weighted
 * round-robin, no per-key policy in the claim query. `priority` orders the claim and does
 * not partition it.
 *
 * The loop, per tick:
 *   1. return abandoned claims to the pool (reclaim = rerun),
 *   2. claim at most `cap − inFlight` jobs,
 *   3. start each claimed job, heartbeating its claim for as long as it runs.
 *
 * **One attempt at a time, per job, per loop.** Every write about a claim is guarded on
 * the per-attempt claim token the store minted (`ClaimedJob.claimToken`), never on this
 * loop's owner string — so a run whose job was reclaimed and re-claimed learns it was
 * displaced on its next heartbeat, even when the loop that displaced it is this one. And
 * if this loop is handed a job it is already running, the displaced attempt is killed and
 * silenced BEFORE the new one starts, rather than being overwritten in `inFlight` and
 * left executing with no handle to kill it by.
 *
 * Nest is deliberately absent from this file: the loop is plain TypeScript over injected
 * collaborators so its concurrency and reclaim behaviour can be tested directly.
 */

import { randomUUID } from "node:crypto";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	type EventBus,
	type RelayMessage,
	runCancelTopic,
	runEventsTopic,
} from "./event-bus.js";
import type { ClaimedJob, JobStore } from "./job-store.js";

/** What a run reports back when it ends. */
export interface RunOutcome {
	outcome: "succeeded" | "failed" | "cancelled";
	retryable: boolean;
	error?: string;
}

/** The channels a running job writes to. */
export interface RunSink {
	onEvent(event: CanonicalEvent): void;
	onStreamDone(): void;
	onProgress(percent: number, message: string): void;
}

/** A run in progress. `cancel` asks nicely; `kill` does not ask. */
export interface RunningJob {
	readonly done: Promise<RunOutcome>;
	cancel(): void;
	kill(): void;
}

export type JobRunner = (job: ClaimedJob, sink: RunSink) => RunningJob;

export interface DispatcherOptions {
	concurrency: number;
	pollIntervalMs: number;
	heartbeatIntervalMs: number;
	staleClaimMs: number;
	/** Base delay before a failed-but-retryable job becomes claimable again. */
	retryBackoffMs?: number;
	/** Owner token for this loop's claims. Defaults to a per-process uuid. */
	owner?: string;
	/** Called when a job is claimed, before it starts. */
	onClaim?: (job: ClaimedJob) => void;
	/** Called when a job reaches a terminal state. */
	onSettled?: (job: ClaimedJob, outcome: RunOutcome) => void;
	log?: {
		info(message: string): void;
		warn(message: string): void;
		error(message: string, error?: unknown): void;
	};
}

const DEFAULT_RETRY_BACKOFF_MS = 5_000;

const NOOP_LOG = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

/**
 * One attempt at a job, as this loop holds it.
 *
 * `live` goes false the moment the attempt is displaced by a newer claim on the same job.
 * A displaced attempt's child may take a while to actually die, and until it does its
 * sink must not speak for the job — its events, and above all its terminal `done`, would
 * otherwise land on the relay topic of the attempt that replaced it and truncate its
 * stream.
 */
interface InFlightAttempt {
	readonly run: RunningJob;
	readonly claimToken: string;
	live: boolean;
}

export class Dispatcher {
	private readonly owner: string;
	private readonly inFlight = new Map<string, InFlightAttempt>();
	private readonly log: NonNullable<DispatcherOptions["log"]>;
	private pollTimer: NodeJS.Timeout | null = null;
	private ticking = false;
	private stopped = false;

	constructor(
		private readonly store: JobStore,
		private readonly bus: EventBus,
		private readonly runner: JobRunner,
		private readonly options: DispatcherOptions,
	) {
		this.owner = options.owner ?? `dispatch-${process.pid}-${randomUUID()}`;
		this.log = options.log ?? NOOP_LOG;
	}

	/** How many runs this loop currently owns. */
	get running(): number {
		return this.inFlight.size;
	}

	get ownerToken(): string {
		return this.owner;
	}

	start(): void {
		if (this.pollTimer) return;
		this.stopped = false;
		this.pollTimer = setInterval(() => {
			void this.tick();
		}, this.options.pollIntervalMs);
		// Never hold the process open on the poll timer alone.
		this.pollTimer.unref?.();
		void this.tick();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		// Kill in-flight children rather than waiting them out. Their claims stop
		// heartbeating, go stale, and are reclaimed — which is exactly the deploy-coupling
		// story this contract exists to make true.
		// These attempts are still the current holders of their jobs, so they are killed
		// but NOT silenced: their `done` is the frame that closes their SSE streams.
		for (const attempt of this.inFlight.values()) attempt.run.kill();
		this.inFlight.clear();
	}

	/**
	 * One pass of the loop. Safe to call directly; re-entrant calls are dropped so a slow
	 * tick cannot stack up behind the interval.
	 */
	async tick(): Promise<void> {
		if (this.ticking || this.stopped) return;
		this.ticking = true;
		try {
			await this.sweepStaleClaims();

			// THE CAP. Claim only what there is room to run — nothing is taken out of the
			// pool that this process cannot start immediately, so a second replica can take
			// it instead.
			const slots = this.options.concurrency - this.inFlight.size;
			if (slots <= 0) return;

			const claimed = await this.store.claim(this.owner, slots);
			for (const job of claimed) this.startJob(job);
		} catch (error) {
			this.log.error("Dispatch tick failed", error);
		} finally {
			this.ticking = false;
		}
	}

	private async sweepStaleClaims(): Promise<void> {
		try {
			const reclaimed = await this.store.reclaimStale(
				this.options.staleClaimMs,
			);
			if (reclaimed.length > 0) {
				this.log.warn(
					`Reclaimed ${reclaimed.length} abandoned job(s) — each will RERUN: ${reclaimed.join(", ")}`,
				);
			}
		} catch (error) {
			this.log.error("Reclaim sweep failed", error);
		}
	}

	private startJob(job: ClaimedJob): void {
		// Being handed a job this loop is already running means our own claim went stale
		// — heartbeats failing for longer than `staleClaimMs` while the child was alive —
		// and this same tick swept it and re-claimed it. The row now belongs to the new
		// claim token, so the older attempt has already lost the claim: it is killed here
		// rather than left to discover that on its next heartbeat, and it is silenced so
		// its dying `done` cannot truncate the replacement's stream. Overwriting it in
		// `inFlight` instead would leave a child running that nothing could ever kill.
		const displaced = this.inFlight.get(job.id);
		if (displaced) {
			displaced.live = false;
			this.inFlight.delete(job.id);
			this.log.warn(
				`Job ${job.id} was re-claimed as ${job.claimToken} while this loop was still running ${displaced.claimToken}; killing the displaced run`,
			);
			displaced.run.kill();
		}

		this.options.onClaim?.(job);

		const eventsTopic = runEventsTopic(job.investigationId);
		// Assigned before any sink callback can fire: the runner is invoked below, and
		// nothing it does synchronously can outrun this closure's own initialisation.
		let attempt: InFlightAttempt | undefined;
		const speaksForTheJob = () => attempt === undefined || attempt.live;
		const sink: RunSink = {
			onEvent: (event) => {
				if (!speaksForTheJob()) return;
				this.bus.publish<RelayMessage>(eventsTopic, { kind: "event", event });
			},
			onStreamDone: () => {
				if (!speaksForTheJob()) return;
				this.bus.publish<RelayMessage>(eventsTopic, { kind: "done" });
			},
			onProgress: () => {
				// Progress is advisory; the durable record is what the UI reads back.
			},
		};

		let running: RunningJob;
		try {
			running = this.runner(job, sink);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.error(`Failed to start job ${job.id}`, error);
			void this.store
				.complete(job.id, job.claimToken, "failed", message)
				.catch((e) =>
					this.log.error(`Failed to record job ${job.id} as failed`, e),
				);
			return;
		}

		attempt = { run: running, claimToken: job.claimToken, live: true };
		this.inFlight.set(job.id, attempt);

		// Cancel is out-of-band: the API publishes on the run's cancel topic and this
		// subscription forwards it to the child. The subscriber count IS the answer to
		// "did anyone hear it" — with no retention, zero receivers means nobody will act.
		const cancelSub = this.bus.subscribe(
			runCancelTopic(job.investigationId),
			() => running.cancel(),
		);

		const heartbeat = setInterval(() => {
			void this.store
				// Guarded on THIS attempt's token, not on the loop's owner string — that is
				// what makes a `false` here mean "you were displaced" even when the loop
				// that displaced you is this one.
				.heartbeat(job.id, job.claimToken)
				.then((held) => {
					if (held) return;
					// The claim is gone — the sweeper judged it dead and someone else may
					// already be rerunning it. Two writers on one investigation is worse than
					// none, so this one stands down.
					this.log.warn(
						`Lost the claim on job ${job.id}; killing the run to avoid a double writer`,
					);
					if (attempt) attempt.live = false;
					running.kill();
				})
				.catch((error) =>
					this.log.error(`Heartbeat failed for ${job.id}`, error),
				);
		}, this.options.heartbeatIntervalMs);
		heartbeat.unref?.();

		void running.done
			.then(async (outcome) => {
				if (outcome.outcome === "failed" && outcome.retryable) {
					const willRetry = await this.store.retryLater(
						job.id,
						job.claimToken,
						this.options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
						outcome.error ?? "run failed",
					);
					if (willRetry) {
						this.log.warn(`Job ${job.id} failed; it will rerun`);
						return;
					}
					// Either the attempts are spent (retryLater recorded the failure) or the
					// claim was lost, in which case whoever holds it now owns the outcome.
					return;
				}
				const settled = await this.store.complete(
					job.id,
					job.claimToken,
					outcome.outcome,
					outcome.error,
				);
				if (!settled) {
					this.log.warn(
						`Job ${job.id} finished but its claim was already reclaimed; the terminal write was refused`,
					);
				}
			})
			.catch((error) => this.log.error(`Settling job ${job.id} failed`, error))
			.finally(() => {
				clearInterval(heartbeat);
				cancelSub.unsubscribe();
				// Only if this attempt is still the one on record. A displaced attempt
				// settles after its replacement has taken the slot, and an unconditional
				// delete here would evict the LIVE run — leaving it unkillable by `stop()`
				// and undercounting the concurrency cap from then on.
				if (this.inFlight.get(job.id) === attempt) this.inFlight.delete(job.id);
				// A freed slot is worth claiming into immediately rather than at the next
				// interval — but not from inside this callback's stack.
				setImmediate(() => void this.tick());
			});

		void running.done
			.then((outcome) => this.options.onSettled?.(job, outcome))
			.catch((error) =>
				this.log.error(`onSettled for job ${job.id} failed`, error),
			);
	}
}
