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
import {
	HARNESS_REGISTRY,
	type HarnessId,
	type ModelSource,
	resolveHarnessModel,
} from "@prismalens/config/harness";
import type {
	InvestigationJobData,
	OperatorMessageMode,
	WorkflowStatus,
} from "@prismalens/contracts";
import {
	InvestigationJobDataSchema,
	isWorkflowTerminal,
} from "@prismalens/contracts";
import { reapLiveHarnesses } from "@prismalens/engine";
import { HarnessService } from "../../core/harness/harness.service.js";
import { RepoSourceService } from "../../core/harness/repo-source.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	TelemetryService,
	triggerFor,
} from "../../core/telemetry/telemetry.service.js";
import { ReportDeliveryService } from "../../modules/delivery/report-delivery.service.js";
import { IncidentsService } from "../../modules/incidents/incidents.service.js";
import { ConnectorResolverService } from "../../modules/integrations/connector-resolver.service.js";
import { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import { ContextPackService } from "../../modules/investigations/context-pack.service.js";
import type { InternalInvestigationResultDto } from "../../modules/investigations/dto/index.js";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import { StreamRelayService } from "../../modules/investigations/stream-relay.service.js";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import { TimelineService } from "../../modules/timeline/timeline.service.js";
import { Dispatcher } from "./dispatcher.js";
import {
	EVENT_BUS,
	type EventBus,
	type RunMessageRequest,
	runCancelTopic,
	runMessageTopic,
} from "./event-bus.js";
import { createInProcessRunner } from "./in-process-runner.js";
import {
	followUpNotDelivered,
	sweepRunWorkspaces,
} from "./investigation-run.js";
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
const FOLLOW_UP_RESTART_REASON =
	"PrismaLens stopped before the follow-up finished. The report is unchanged.";

/**
 * The model a run asks for and where it came from. A harness that cannot take
 * a model never gets here with one set: the selection refused it first
 * (`refuseModel`, #639 rec 4), and it never claims a `modelSource`.
 */
export function resolveHarnessRunModel(
	harnessId: HarnessId,
	operatorModel: string | undefined,
): { model?: string; modelSource?: ModelSource } {
	if (HARNESS_REGISTRY[harnessId].modelVia === "unsupported") return {};
	const resolved = resolveHarnessModel(harnessId, operatorModel);
	return {
		...(resolved.model ? { model: resolved.model } : {}),
		modelSource: resolved.source,
	};
}

@Injectable()
export class DispatchService implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(DispatchService.name);
	private readonly store: JobStore;
	private readonly dispatcher: Dispatcher;

	constructor(
		@Inject(EVENT_BUS) private readonly bus: EventBus,
		private readonly streamRelay: StreamRelayService,
		private readonly investigationsService: InvestigationsService,
		private readonly incidentsService: IncidentsService,
		private readonly timelineService: TimelineService,
		private readonly harnessService: HarnessService,
		private readonly repoSource: RepoSourceService,
		private readonly prisma: PrismaService,
		private readonly integrationsService: IntegrationsService,
		private readonly connectorResolver: ConnectorResolverService,
		private readonly contextPackService: ContextPackService,
		private readonly telemetry: TelemetryService,
		private readonly reportDelivery: ReportDeliveryService,
	) {
		// The store takes the delegate structurally (narrowed to the calls it
		// makes), so it stays testable without a database. `PrismaService` forwards
		// each model explicitly — `job` must be one of them or this is undefined at
		// runtime while typechecking clean.
		this.store = new PrismaJobStore(this.prisma.job as unknown as JobDelegate);

		const ports: RunPorts = {
			findInvestigation: async (id) => {
				const investigation = await this.investigationsService.findById(id);
				return investigation
					? {
							id: investigation.id,
							status: investigation.status,
							harness: investigation.harness ?? null,
							model: investigation.model ?? null,
							acpSessionId: investigation.acpSessionId ?? null,
							workspace: investigation.workspace ?? null,
						}
					: null;
			},
			updateStatus: async (id, dto) => {
				await this.investigationsService.updateStatusInternal(
					id,
					dto.status,
					dto.startedAt,
					dto.error,
					dto.harnessThreadId,
					{
						harness: dto.harness,
						model: dto.model,
						acpSessionId: dto.acpSessionId,
						workspace: dto.workspace,
					},
				);
				if (dto.status === "failed") void this.reportDelivery.deliver(id);
				await this.reportStatus(id, dto.status);
			},
			followUpStatus: async (id, state) => {
				await this.prisma.investigation.update({
					where: { id },
					data: {
						status: state.status,
						...(state.completedAt !== undefined
							? { completedAt: state.completedAt }
							: {}),
						...(state.error !== undefined ? { error: state.error } : {}),
					},
				});
			},
			recordSession: async (id, acpSessionId) => {
				await this.prisma.investigation.update({
					where: { id },
					data: { acpSessionId },
				});
			},
			lastEventSeq: (id) => this.investigationsService.lastEventSeq(id),
			appendEvents: async (id, events) => {
				await this.investigationsService.appendEvents(id, events);
			},
			clearEvents: async (id) => {
				await this.investigationsService.clearEvents(id);
			},
			writeResult: async (id, dto: InternalInvestigationResultDto) => {
				await this.investigationsService.writeResultWithRelations(id, dto);
				// Off the run's path: a slow or failing Slack never delays or fails it.
				void this.reportDelivery.deliver(id);
				await this.reportStatus(id, dto.status);
			},
			createTimelineEntry: async (dto: CreateTimelineEntryDto) => {
				await this.timelineService.create(dto);
			},
			resolveHarness: async () => {
				const [selection, settings] = await Promise.all([
					this.harnessService.resolveSelection(),
					this.harnessService.getSettings(),
				]);
				if (!selection.runnable) return { selection };
				const modelResult = resolveHarnessRunModel(
					selection.harness,
					settings.models?.[selection.harness],
				);
				return { selection, ...modelResult };
			},
			incidentRepos: async (incidentId) => {
				const service = {
					select: {
						id: true,
						name: true,
						repositories: {
							orderBy: [
								{ isPrimary: "desc" as const },
								{ createdAt: "asc" as const },
							],
							select: {
								subPath: true,
								repository: {
									select: {
										sourceKind: true,
										url: true,
										defaultBranch: true,
										connectionId: true,
									},
								},
							},
						},
					},
				};
				// The same set incidents.list shows: own service, then every alert's (#743).
				const [incident, alerts] = await Promise.all([
					this.prisma.incident.findUnique({
						where: { id: incidentId },
						select: { service },
					}),
					this.prisma.alert.findMany({
						where: { incidentId, serviceId: { not: null } },
						distinct: ["serviceId"],
						orderBy: { createdAt: "asc" },
						select: { service },
					}),
				]);
				const services = new Map<
					string,
					NonNullable<NonNullable<typeof incident>["service"]>
				>();
				for (const s of [incident?.service, ...alerts.map((a) => a.service)])
					if (s && !services.has(s.id)) services.set(s.id, s);
				return [...services.values()].flatMap((s) =>
					s.repositories.map((r) => ({
						sourceKind:
							r.repository.sourceKind === "folder"
								? ("folder" as const)
								: ("url" as const),
						url: r.repository.url,
						defaultBranch: r.repository.defaultBranch,
						subPath: r.subPath,
						connectionId: r.repository.connectionId,
						serviceName: s.name,
					})),
				);
			},
			repoToken: (connectionId) =>
				this.integrationsService.gitToken(connectionId),
			snapshot: (src, dest, signal, at) =>
				this.repoSource.snapshot(src, dest, signal, at),
			getIncident: async (id) => {
				const incident = await this.incidentsService.findById(id);
				return incident as unknown as Record<string, unknown> | null;
			},
			resolveConnectors: (serviceId) =>
				this.connectorResolver.resolve({ serviceId }),
			contextPack: (incidentId) => this.contextPackService.assemble(incidentId),
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

	/** Opt-in telemetry (#602): a run starting, and its one terminal state. */
	private async reportStatus(id: string, status: string): Promise<void> {
		if (status !== "running" && !isWorkflowTerminal(status)) return;
		// The harness lookup scans PATH and the row read is an extra query, so
		// neither happens unless something would actually be sent.
		if (!(await this.telemetry.isEnabled())) return;

		const investigation = await this.investigationsService
			.findById(id)
			.catch(() => null);

		if (status === "running") {
			const selection = await this.harnessService
				.resolveSelection()
				.catch(() => null);
			await this.telemetry.capture("investigation_started", {
				harness: selection?.runnable ? selection.harness : null,
				trigger: triggerFor(investigation?.triggerType),
			});
			return;
		}
		// `startedAt` becomes a bucket and `error` becomes a class inside the
		// service; neither the duration nor the message leaves this process.
		await this.telemetry.captureFinished(
			id,
			status as "completed" | "failed" | "cancelled",
			{ startedAt: investigation?.startedAt, error: investigation?.error },
		);
	}

	async onModuleInit(): Promise<void> {
		// An API restart abandons whatever was `running` — there is no reclaim any
		// more (0005 §2: one process). Fail those rows and their investigations
		// before the loop starts, so nothing sits stuck "running" forever.
		const ids = await this.store.failRunning(RESTART_REASON);
		for (const id of ids) {
			const restored = await this.restoreFollowUp(
				id,
				FOLLOW_UP_RESTART_REASON,
			).catch((e) => {
				this.logger.warn(
					`Could not restore follow-up ${id}: ${(e as Error).message}`,
				);
				return false;
			});
			if (restored) continue;
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
		try {
			const swept = sweepRunWorkspaces();
			if (swept > 0)
				this.logger.warn(`Removed the leftover workspaces of ${swept} run(s)`);
		} catch (e) {
			this.logger.warn("Could not sweep leftover run workspaces", e);
		}
		this.dispatcher.start();
		this.logger.log(
			`Dispatch loop started, concurrency cap ${getConfig().PRISMALENS_DISPATCH_CONCURRENCY}, owner ${this.dispatcher.ownerToken}`,
		);
	}

	async onApplicationShutdown(): Promise<void> {
		await this.dispatcher.stop();
		// Aborting a run only asks the harness to stop; its own process group
		// never saw the terminal's signal, so kill it before the API exits.
		reapLiveHarnesses();
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
	 * Reopen a finished run for one follow-up message (#747). The compare-and-set
	 * admits one of two racing sends; the job puts status, completedAt and error
	 * back when the follow-up ends. Returns false when a follow-up already holds it.
	 */
	async resumeInvestigation(
		id: string,
		text: string,
		mode: OperatorMessageMode,
	): Promise<boolean> {
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: {
				incidentId: true,
				status: true,
				completedAt: true,
				error: true,
			},
		});
		if (!row || !isWorkflowTerminal(row.status)) return false;
		const { count } = await this.prisma.investigation.updateMany({
			where: { id, status: row.status },
			data: {
				status: "pending",
				completedAt: null,
				error: null,
				stopRequestedAt: null,
			},
		});
		if (count === 0) return false;
		const restore = {
			status: row.status as WorkflowStatus,
			completedAt: row.completedAt?.toISOString() ?? null,
			error: row.error,
		};
		const jobId = await this.addInvestigationJob({
			incidentId: row.incidentId,
			investigationId: id,
			resume: { text, mode, restore },
		});
		if (jobId === null) {
			await this.prisma.investigation.update({
				where: { id },
				data: {
					status: restore.status,
					completedAt: row.completedAt,
					error: row.error,
				},
			});
			throw new Error("The follow-up could not be queued.");
		}
		return true;
	}

	/**
	 * Ask a running investigation to stop.
	 *
	 * Returns how many receivers took the request. The EventBus has no retention, so 0
	 * means nobody holds the run and nobody will ever write its terminal state — the
	 * caller must write it. Same contract the Redis cancel channel had.
	 */
	/** Hand a live run an operator message; null when nothing holds the run or it stopped listening. */
	sendMessage(
		investigationId: string,
		text: string,
		mode: "queue" | "now",
	): "queued" | "sent" | null {
		let state: "queued" | "sent" | null = null;
		this.bus.publish<RunMessageRequest>(runMessageTopic(investigationId), {
			text,
			mode,
			reply: (s) => {
				state = s;
			},
		});
		return state;
	}

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
	 * A follow-up that ends without its run (cancelled unclaimed, or cut off by a
	 * restart) puts back the finished investigation it reopened (#752), and says so in
	 * the conversation. False when the investigation's job was not a follow-up.
	 */
	async restoreFollowUp(
		investigationId: string,
		reason: string,
	): Promise<boolean> {
		const job = await this.prisma.job.findUnique({
			where: { investigationId },
			select: { payload: true },
		});
		let resume: InvestigationJobData["resume"];
		try {
			resume = job
				? InvestigationJobDataSchema.parse(JSON.parse(job.payload)).resume
				: undefined;
		} catch {
			return false;
		}
		if (!resume) return false;
		const seq =
			(await this.investigationsService.lastEventSeq(investigationId)) + 1;
		try {
			await this.investigationsService.appendEvents(
				investigationId,
				followUpNotDelivered(investigationId, seq, resume, reason),
			);
		} catch (e) {
			this.logger.warn(
				`Could not record the ended follow-up in the conversation: ${(e as Error).message}`,
			);
		}
		await this.prisma.investigation.update({
			where: { id: investigationId },
			data: {
				status: resume.restore.status,
				completedAt: resume.restore.completedAt
					? new Date(resume.restore.completedAt)
					: null,
				error: resume.restore.error,
				stopRequestedAt: null,
			},
		});
		return true;
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
