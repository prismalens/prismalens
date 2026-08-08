// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Nest-facing face of dispatch: enqueue, cancel, and status, plus ownership of the
 * loop's lifecycle. All of the interesting behaviour lives in {@link Dispatcher} and
 * {@link PrismaJobStore}; this is the wiring.
 *
 * JobStore and EventBus are DISPATCH-LAYER seams, outside the engine. Neither is a port
 * on `conductRun`, which takes exactly two injected ports and gains no third.
 */

import {
	Inject,
	Injectable,
	Logger,
	OnApplicationShutdown,
	OnModuleInit,
} from "@nestjs/common";
import { assertDispatchTopology, getConfig } from "@prismalens/config";
import type { InvestigationJobData } from "@prismalens/contracts";
// biome-ignore lint/style/useImportType: Nest's DI needs the runtime class reference.
import { PrismaService } from "../../core/prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: Nest's DI needs the runtime class reference.
import { StreamRelayService } from "../../modules/investigations/stream-relay.service.js";
import { Dispatcher } from "./dispatcher.js";
import { EVENT_BUS, type EventBus, runCancelTopic } from "./event-bus.js";
import { createForkRunner } from "./fork-runner.js";
import {
	type JobDelegate,
	type JobStore,
	PrismaJobStore,
} from "./job-store.js";

export type { InvestigationJobData };

/** Priority ordering for the claim. Lower claims first. NOT a fairness key. */
const PRIORITY_ORDER: Record<string, number> = {
	critical: 1,
	high: 2,
	normal: 3,
	low: 4,
};

@Injectable()
export class DispatchService implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(DispatchService.name);
	private readonly store: JobStore;
	private readonly dispatcher: Dispatcher;
	private readonly enabled: boolean;
	private readonly maxAttempts: number;

	constructor(
		prisma: PrismaService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
		private readonly streamRelay: StreamRelayService,
	) {
		const config = getConfig();
		this.enabled = config.PRISMALENS_DISPATCH_ENABLED;
		this.maxAttempts = config.PRISMALENS_DISPATCH_MAX_ATTEMPTS;

		// The store takes the delegate structurally (narrowed to the four calls it
		// makes), so it stays testable without a database. `PrismaService` forwards
		// each model explicitly — `job` must be one of them or this is undefined at
		// runtime while typechecking clean.
		this.store = new PrismaJobStore(prisma.job as unknown as JobDelegate);

		this.dispatcher = new Dispatcher(
			this.store,
			this.bus,
			createForkRunner({
				...(config.PRISMALENS_WORKER_ENTRY
					? { entry: config.PRISMALENS_WORKER_ENTRY }
					: {}),
				log: {
					warn: (m) => this.logger.warn(m),
					error: (m) => this.logger.error(m),
				},
			}),
			{
				concurrency: config.PRISMALENS_DISPATCH_CONCURRENCY,
				pollIntervalMs: config.PRISMALENS_DISPATCH_POLL_INTERVAL_MS,
				heartbeatIntervalMs: config.PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS,
				staleClaimMs: config.PRISMALENS_DISPATCH_STALE_CLAIM_MS,
				// A reclaimed job RERUNS, so the relay must be listening again before its
				// first event — the run does not resume where it left off.
				onClaim: (job) => this.streamRelay.attach(job.investigationId),
				onSettled: (job) =>
					this.logger.log(`Job ${job.id} settled (${job.investigationId})`),
				log: {
					info: (m) => this.logger.log(m),
					warn: (m) => this.logger.warn(m),
					error: (m, e) => this.logger.error(m, e),
				},
			},
		);
	}

	onModuleInit(): void {
		// Boot refuses an API process that does not run the loop. The EventBus is
		// in-process only, so such a process cannot stream a run or cancel one, and it
		// would go on to write terminal states over runs that are still executing
		// elsewhere. See `assertDispatchTopology` for why this is fatal and not a warning.
		assertDispatchTopology({ PRISMALENS_DISPATCH_ENABLED: this.enabled });
		this.dispatcher.start();
		this.logger.log(
			`Dispatch loop started, concurrency cap ${getConfig().PRISMALENS_DISPATCH_CONCURRENCY}, owner ${this.dispatcher.ownerToken}`,
		);
	}

	async onApplicationShutdown(): Promise<void> {
		await this.dispatcher.stop();
	}

	/**
	 * Enqueue an investigation. Returns the job id, or null when the row could not be
	 * written — the caller treats that as an enqueue failure and marks the investigation
	 * failed rather than leaving it pending forever.
	 */
	async addInvestigationJob(
		data: InvestigationJobData,
	): Promise<string | null> {
		try {
			const jobId = await this.store.enqueue({
				investigationId: data.investigationId,
				incidentId: data.incidentId,
				payload: JSON.stringify(data),
				priority: PRIORITY_ORDER[data.priority ?? "normal"] ?? 3,
				maxAttempts: this.maxAttempts,
			});
			// Attach the relay at enqueue time, exactly as the Redis subscription used to
			// be opened here: the buffer must exist before the run's first event.
			this.streamRelay.attach(data.investigationId);
			this.logger.log(
				`Enqueued investigation job ${jobId} for incident ${data.incidentId}`,
			);
			// Don't wait for the next poll interval to notice work that just arrived.
			void this.dispatcher.tick();
			return jobId;
		} catch (error) {
			this.logger.error(
				`Failed to enqueue investigation ${data.investigationId}`,
				error,
			);
			return null;
		}
	}

	/**
	 * Ask a running investigation to stop.
	 *
	 * Returns how many receivers took the request. The EventBus has no retention, so 0
	 * means nobody holds the run and nobody will ever write its terminal state — the
	 * caller must write it. Same contract the Redis cancel channel had.
	 */
	async requestCancel(investigationId: string): Promise<number> {
		const receivers = this.bus.publish(runCancelTopic(investigationId), {
			kind: "cancel",
		});
		this.logger.log(
			`Published cancel for investigation ${investigationId} (${receivers} receiver(s))`,
		);
		return receivers;
	}

	/**
	 * Cancel a job that has not been claimed yet. Returns false when a claimer won the
	 * race — the caller then falls through to {@link requestCancel} and the live run owns
	 * the terminal write.
	 */
	async cancelPendingJob(investigationId: string): Promise<boolean> {
		try {
			const cancelled = await this.store.cancelIfPending(investigationId);
			if (cancelled) {
				this.logger.log(
					`Cancelled unclaimed investigation job for ${investigationId}`,
				);
			}
			return cancelled;
		} catch (error) {
			this.logger.warn(
				`Could not cancel pending job for ${investigationId}: ${(error as Error).message}`,
			);
			return false;
		}
	}

	/**
	 * Cancel the job row of a run nobody holds, after {@link requestCancel} found zero
	 * receivers on every attempt. Without this the row stays `running`, goes stale, and
	 * `reclaimStale` returns it to `pending` — rerunning an investigation the user
	 * cancelled. Returns whether a running row was cancelled.
	 */
	async cancelOrphanedRun(investigationId: string): Promise<boolean> {
		try {
			const cancelled = await this.store.cancelOrphanedRun(investigationId);
			if (cancelled) {
				this.logger.log(
					`Cancelled the orphaned investigation job for ${investigationId}`,
				);
			}
			return cancelled;
		} catch (error) {
			this.logger.warn(
				`Could not cancel the orphaned job for ${investigationId}: ${(error as Error).message}`,
			);
			return false;
		}
	}

	/** Status of the job behind an investigation, or null when there is none. */
	async getJobStatus(investigationId: string): Promise<{
		id: string;
		status: string;
		attempts: number;
		error: string | null;
	} | null> {
		const job = await this.store.findByInvestigation(investigationId);
		if (!job) return null;
		return {
			id: job.id,
			status: job.status,
			attempts: job.attempts,
			error: job.lastError,
		};
	}
}
