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

export class Dispatcher {
	private readonly owner: string;
	private readonly inFlight = new Map<string, RunningJob>();
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
		for (const run of this.inFlight.values()) run.kill();
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
		this.options.onClaim?.(job);

		const eventsTopic = runEventsTopic(job.investigationId);
		const sink: RunSink = {
			onEvent: (event) =>
				this.bus.publish<RelayMessage>(eventsTopic, { kind: "event", event }),
			onStreamDone: () =>
				this.bus.publish<RelayMessage>(eventsTopic, { kind: "done" }),
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
			void this.store.complete(job.id, "failed", message);
			return;
		}

		this.inFlight.set(job.id, running);

		// Cancel is out-of-band: the API publishes on the run's cancel topic and this
		// subscription forwards it to the child. The subscriber count IS the answer to
		// "did anyone hear it" — with no retention, zero receivers means nobody will act.
		const cancelSub = this.bus.subscribe(
			runCancelTopic(job.investigationId),
			() => running.cancel(),
		);

		const heartbeat = setInterval(() => {
			void this.store
				.heartbeat(job.id, this.owner)
				.then((held) => {
					if (held) return;
					// The claim is gone — the sweeper judged it dead and someone else may
					// already be rerunning it. Two writers on one investigation is worse than
					// none, so this one stands down.
					this.log.warn(
						`Lost the claim on job ${job.id}; killing the run to avoid a double writer`,
					);
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
						this.options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
						outcome.error ?? "run failed",
					);
					if (willRetry) {
						this.log.warn(`Job ${job.id} failed; it will rerun`);
						return;
					}
					// Attempts exhausted — retryLater already recorded the failure.
					return;
				}
				await this.store.complete(job.id, outcome.outcome, outcome.error);
			})
			.catch((error) => this.log.error(`Settling job ${job.id} failed`, error))
			.finally(() => {
				clearInterval(heartbeat);
				cancelSub.unsubscribe();
				this.inFlight.delete(job.id);
				// A freed slot is worth claiming into immediately rather than at the next
				// interval — but not from inside this callback's stack.
				setImmediate(() => void this.tick());
			});

		void running.done.then((outcome) => this.options.onSettled?.(job, outcome));
	}
}
