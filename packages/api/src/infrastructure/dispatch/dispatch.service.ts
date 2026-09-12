// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Nest-facing face of dispatch: enqueue, cancel, and status, plus ownership of the
 * loop's lifecycle. All of the interesting behaviour lives in {@link Dispatcher} and
 * {@link PrismaJobStore}; this is the wiring — including, since 0005 §2, the
 * {@link RunPorts} object the in-process runner uses instead of internal HTTP calls.
 */

import {
	Inject,
	Injectable,
	Logger,
	OnApplicationShutdown,
	OnModuleInit,
} from "@nestjs/common";
import { getConfig } from "@prismalens/config";
import { getApiKeyEnvVar } from "@prismalens/config/llm";
import type { InvestigationJobData } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { LlmSettingsService } from "../../core/settings/llm-settings.service.js";
import { IncidentsService } from "../../modules/incidents/incidents.service.js";
import { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import type { InternalInvestigationResultDto } from "../../modules/investigations/dto/index.js";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import { StreamRelayService } from "../../modules/investigations/stream-relay.service.js";
import { ServicesService } from "../../modules/services/services.service.js";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import { TimelineService } from "../../modules/timeline/timeline.service.js";
import { Dispatcher } from "./dispatcher.js";
import { EVENT_BUS, type EventBus, runCancelTopic } from "./event-bus.js";
import { createInProcessRunner } from "./in-process-runner.js";
import {
	type JobDelegate,
	type JobStore,
	PrismaJobStore,
} from "./job-store.js";
import type { RunPorts } from "./run-ports.js";

export type { InvestigationJobData };

/** Priority ordering for the claim. Lower claims first. NOT a fairness key. */
const PRIORITY_ORDER: Record<string, number> = {
	critical: 1,
	high: 2,
	normal: 3,
	low: 4,
};

/** The reason recorded on every job a restart abandoned mid-flight. */
const RESTART_REASON = "API restarted while the run was in flight";

@Injectable()
export class DispatchService implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(DispatchService.name);
	private readonly store: JobStore;
	private readonly dispatcher: Dispatcher;

	constructor(
		prisma: PrismaService,
		@Inject(EVENT_BUS) private readonly bus: EventBus,
		private readonly streamRelay: StreamRelayService,
		private readonly investigationsService: InvestigationsService,
		private readonly incidentsService: IncidentsService,
		private readonly timelineService: TimelineService,
		private readonly llmSettingsService: LlmSettingsService,
		private readonly integrationsService: IntegrationsService,
		private readonly servicesService: ServicesService,
	) {
		// The store takes the delegate structurally (narrowed to the calls it
		// makes), so it stays testable without a database. `PrismaService` forwards
		// each model explicitly — `job` must be one of them or this is undefined at
		// runtime while typechecking clean.
		this.store = new PrismaJobStore(prisma.job as unknown as JobDelegate);

		const ports: RunPorts = {
			findInvestigation: async (id) => {
				const investigation = await this.investigationsService.findById(id);
				return investigation
					? { id: investigation.id, status: investigation.status }
					: null;
			},
			updateStatus: async (id, dto) => {
				await this.investigationsService.updateStatusInternal(
					id,
					dto.status,
					dto.startedAt,
					dto.error,
					dto.harnessThreadId,
				);
			},
			appendEvents: async (id, events) => {
				await this.investigationsService.appendEvents(id, events);
			},
			clearEvents: async (id) => {
				await this.investigationsService.clearEvents(id);
			},
			writeResult: async (id, dto: InternalInvestigationResultDto) => {
				await this.investigationsService.writeResultWithRelations(id, dto);
			},
			createTimelineEntry: async (dto: CreateTimelineEntryDto) => {
				await this.timelineService.create(dto);
			},
			resolveLlm: async () => {
				const { provider, model, baseUrl, harness } =
					await this.llmSettingsService.resolveActiveLlmConfig();
				const credentials: Record<string, string> = {};
				if (provider) {
					const apiKey = this.llmSettingsService.resolveApiKey(provider);
					const envVar = getApiKeyEnvVar(provider);
					if (envVar && apiKey) credentials[envVar] = apiKey;
				}
				return { provider, model, baseUrl, credentials, harness };
			},
			integrationCredentials: (connectionIds) =>
				this.integrationsService.getIntegrationsByConnectionIds(connectionIds),
			getIncident: async (id) => {
				const incident = await this.incidentsService.findById(id);
				return incident as unknown as Record<string, unknown> | null;
			},
			listServices: async (search) => {
				const { data } = await this.servicesService.findAll({ search });
				return data as unknown as Array<Record<string, unknown>>;
			},
		};

		this.dispatcher = new Dispatcher(
			this.store,
			this.bus,
			createInProcessRunner(ports),
			{
				concurrency: getConfig().PRISMALENS_DISPATCH_CONCURRENCY,
				// A claim still races the stream controller's own subscribe, so
				// attaching the relay here (before the run's first event) stays
				// correct even though there is no reclaim any more to re-attach for.
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

	async onModuleInit(): Promise<void> {
		// An API restart abandons whatever was `running` — there is no reclaim any
		// more (0005 §2: one process). Fail those rows and their investigations
		// before the loop starts, so nothing sits stuck "running" forever.
		const ids = await this.store.failRunning(RESTART_REASON);
		for (const id of ids) {
			await this.investigationsService.updateStatusInternal(
				id,
				"failed",
				undefined,
				RESTART_REASON,
			);
		}
		if (ids.length > 0) {
			this.logger.warn(
				`Failed ${ids.length} investigation(s) left running by a previous process: ${ids.join(", ")}`,
			);
		}
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
			});
			// Attach the relay at enqueue time, exactly as the Redis subscription used to
			// be opened here: the buffer must exist before the run's first event.
			this.streamRelay.attach(data.investigationId);
			this.logger.log(
				`Enqueued investigation job ${jobId} for incident ${data.incidentId}`,
			);
			// Don't wait for the next tick to notice work that just arrived.
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
	 * receivers on every attempt. Without this the row stays `running` until the next
	 * restart, when the boot-time sweep marks it failed rather than the cancellation the
	 * user asked for. Returns whether a running row was cancelled.
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
