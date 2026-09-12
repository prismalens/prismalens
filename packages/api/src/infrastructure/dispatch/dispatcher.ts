// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The dispatch loop (0005 §2): one process runs every investigation
 * in-process, so this loop needs no poll timer, no heartbeat, and no reclaim
 * sweep — there is exactly one writer and it never goes silent without the
 * whole process going down with it. `tick()` runs on `start()`, after every
 * enqueue, and after every settle, instead of on an interval.
 *
 * **Fairness is a global concurrency cap and nothing more.** No fairness key, no
 * weighted round-robin, no per-key policy in the claim query. `priority` orders
 * the claim and does not partition it.
 *
 * Nest is deliberately absent from this file: the loop is plain TypeScript over
 * injected collaborators so its concurrency behaviour can be tested directly.
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

const NOOP_LOG = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

export class Dispatcher {
	private readonly owner: string;
	private readonly inFlight = new Map<string, RunningJob>();
	private readonly log: NonNullable<DispatcherOptions["log"]>;
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
		this.stopped = false;
		void this.tick();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		for (const run of this.inFlight.values()) run.kill();
		this.inFlight.clear();
	}

	/**
	 * One pass of the loop. Safe to call directly; re-entrant calls are dropped so a slow
	 * tick cannot stack up behind another one already running.
	 */
	async tick(): Promise<void> {
		if (this.ticking || this.stopped) return;
		this.ticking = true;
		try {
			// THE CAP. Claim only what there is room to run.
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

	private startJob(job: ClaimedJob): void {
		this.options.onClaim?.(job);

		const eventsTopic = runEventsTopic(job.investigationId);
		const sink: RunSink = {
			onEvent: (event) => {
				this.bus.publish<RelayMessage>(eventsTopic, { kind: "event", event });
			},
			onStreamDone: () => {
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
				.complete(job.id, "failed", message)
				.catch((e) =>
					this.log.error(`Failed to record job ${job.id} as failed`, e),
				);
			return;
		}

		this.inFlight.set(job.id, running);

		// Cancel is out-of-band: the API publishes on the run's cancel topic and this
		// subscription forwards it to the run. The subscriber count IS the answer to
		// "did anyone hear it" — with no retention, zero receivers means nobody will act.
		const cancelSub = this.bus.subscribe(
			runCancelTopic(job.investigationId),
			() => running.cancel(),
		);

		void running.done
			.then(async (outcome) => {
				const settled = await this.store.complete(
					job.id,
					outcome.outcome,
					outcome.error,
				);
				if (!settled) {
					this.log.warn(
						`Job ${job.id} finished but its claim was already gone; the terminal write was refused`,
					);
				}
			})
			.catch((error) => this.log.error(`Settling job ${job.id} failed`, error))
			.finally(() => {
				cancelSub.unsubscribe();
				this.inFlight.delete(job.id);
				// A freed slot is worth claiming into immediately rather than waiting for
				// the next enqueue — but not from inside this callback's stack.
				setImmediate(() => void this.tick());
			});

		void running.done
			.then((outcome) => this.options.onSettled?.(job, outcome))
			.catch((error) =>
				this.log.error(`onSettled for job ${job.id} failed`, error),
			);
	}
}
