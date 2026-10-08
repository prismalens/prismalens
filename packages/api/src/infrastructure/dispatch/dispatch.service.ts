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
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	type ModelSource,
	resolveHarnessModel,
} from "@prismalens/config/harness";
import type {
	FollowUpKind,
	InvestigationJobData,
	JobAttachment,
	OperatorMessageMode,
	RunChoice,
	TurnOutcome,
	WorkflowStatus,
} from "@prismalens/contracts";
import {
	InvestigationJobDataSchema,
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
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

/** A follow-up the run's state rules out; the controller answers CONFLICT with it. */
export class FollowUpRefused extends Error {}

/**
 * The agent mode a stored job payload names; undefined when it names none or
 * does not parse. A legacy `access` is dropped, so the run takes its row's default.
 */
function jobAgentMode(payload: string): string | undefined {
	try {
		return InvestigationJobDataSchema.parse(JSON.parse(payload)).agentMode;
	} catch {
		return undefined;
	}
}

/** Priority ordering for the claim. Lower claims first. NOT a fairness key. */
const PRIORITY_ORDER: Record<string, number> = {
	critical: 1,
	high: 2,
	normal: 3,
	low: 4,
};

/** The reason recorded on every job a restart abandoned mid-flight. */
const RESTART_REASON = "API restarted while the run was in flight";
const UNQUEUED_REASON = "PrismaLens restarted before the run was queued";
const FOLLOW_UP_RESTART_REASON =
	"PrismaLens stopped before the follow-up finished. The report is unchanged.";

/** The job payload's follow-up, or undefined for a first run or a payload that does not parse. */
function jobResume(payload: string): InvestigationJobData["resume"] {
	try {
		return InvestigationJobDataSchema.parse(JSON.parse(payload)).resume;
	} catch {
		return undefined;
	}
}

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
	const resolved = resolveHarnessModel(harnessId, operatorModel, process.env);
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
							effort: investigation.effort ?? null,
							acpSessionId: investigation.acpSessionId ?? null,
							workspace: investigation.workspace ?? null,
							kind: investigation.kind,
							stopRequestedAt: investigation.stopRequestedAt ?? null,
						}
					: null;
			},
			updateStatus: async (id, dto) => {
				const written = await this.investigationsService.updateStatusInternal(
					id,
					dto.status,
					dto.startedAt,
					dto.error,
					dto.harnessThreadId,
					{
						harness: dto.harness,
						model: dto.model,
						effort: dto.effort,
						acpSessionId: dto.acpSessionId,
						workspace: dto.workspace,
						agentMode: dto.agentMode,
						lastTurnOutcome: dto.lastTurnOutcome,
					},
				);
				// A refused write delivers nothing and counts nothing (#673 w59).
				if (!written) return false;
				if (dto.status === "failed") void this.reportDelivery.deliver(id);
				await this.reportStatus(id, dto.status);
				return true;
			},
			initLiveTurn: (id, turn) =>
				this.investigationsService.initLiveTurn(id, turn),
			settleFollowUp: (id, end, opts) =>
				this.investigationsService.settleFollowUp(id, end, opts),
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
				const written =
					await this.investigationsService.writeResultWithRelations(id, dto);
				if (!written) return false;
				// Off the run's path: a slow or failing Slack never delays or fails it.
				void this.reportDelivery.deliver(id);
				await this.reportStatus(id, dto.status);
				return true;
			},
			createTimelineEntry: async (dto: CreateTimelineEntryDto) => {
				await this.timelineService.create(dto);
			},
			resolveHarness: (requested) => this.resolveHarness(requested),
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

	/**
	 * The run's agent, model and effort: each the request's when it named one, else
	 * Settings' for that agent (#673 w52). `null` asks for the agent's own default.
	 */
	async resolveHarness(
		requested: RunChoice = {},
	): ReturnType<RunPorts["resolveHarness"]> {
		const [selection, settings] = await Promise.all([
			this.harnessService.resolveSelection(requested),
			this.harnessService.getSettings(),
		]);
		if (!selection.runnable) return { selection };
		const h = selection.harness;
		const pick = (asked: string | null | undefined, stored?: string) =>
			asked === undefined ? stored : (asked ?? undefined);
		const effort = pick(requested.effort, settings.efforts?.[h]);
		const agentMode = settings.agentModes?.[h];
		return {
			selection,
			...resolveHarnessRunModel(h, pick(requested.model, settings.models?.[h])),
			...(effort ? { effort } : {}),
			...(agentMode ? { agentMode } : {}),
		};
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
			// The run's own agent, which its chip may have changed from Settings' (#673 w52).
			const ran = HARNESS_IDS.find((h) => h === investigation?.harness);
			const selection = ran
				? null
				: await this.harnessService.resolveSelection().catch(() => null);
			await this.telemetry.capture("investigation_started", {
				harness: ran ?? (selection?.runnable ? selection.harness : null),
				trigger: triggerFor(investigation?.triggerType, investigation?.kind),
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
		// more (0005 §2: one process). Fail those jobs, then settle every live row
		// against its job before the loop starts, so nothing sits live forever.
		const ids = await this.store.failRunning(RESTART_REASON);
		if (ids.length > 0) {
			this.logger.warn(
				`Failed ${ids.length} investigation(s) left running by a previous process: ${ids.join(", ")}`,
			);
		}
		await this.reconcileLiveRows(new Set(ids)).catch((e) =>
			this.logger.warn(
				`Could not reconcile live runs at boot: ${(e as Error).message}`,
			),
		);
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
	 * Boot reconciliation (#673 w59, DESIGN §3.4): every row left live is
	 * settled against its job. A pending job stays to be claimed; anything
	 * else ends the row, and a recorded Stop always ends it as a stop.
	 */
	private async reconcileLiveRows(wasRunning: Set<string>): Promise<void> {
		const rows = await this.prisma.investigation.findMany({
			where: { status: { in: [...LIVE_WORKFLOW_STATUSES] } },
			select: {
				id: true,
				incidentId: true,
				kind: true,
				stopRequestedAt: true,
				createdAt: true,
			},
			orderBy: { createdAt: "asc" },
		});
		const waiting: typeof rows = [];
		for (const row of rows) {
			const job = await this.prisma.job.findUnique({
				where: { investigationId: row.id },
				select: { status: true, payload: true },
			});
			if (job?.status === "pending") {
				waiting.push(row);
				continue;
			}
			const stopped =
				!!row.stopRequestedAt ||
				(!wasRunning.has(row.id) && job?.status === "cancelled");
			await this.endAtBoot(row, job, stopped).catch((e) =>
				this.logger.warn(
					`Could not settle run ${row.id} at boot: ${(e as Error).message}`,
				),
			);
		}
		// Old data can hold two live rows on one incident: the newest keeps its claim.
		const byIncident = new Map<string, typeof rows>();
		for (const row of waiting)
			byIncident.set(row.incidentId, [
				...(byIncident.get(row.incidentId) ?? []),
				row,
			]);
		for (const [incidentId, live] of byIncident) {
			if (live.length < 2) continue;
			this.logger.warn(
				`Incident ${incidentId} had ${live.length} live runs; keeping the newest`,
			);
			for (const row of live.slice(0, -1)) {
				await this.cancelPendingJob(row.id);
				const job = await this.prisma.job.findUnique({
					where: { investigationId: row.id },
					select: { status: true, payload: true },
				});
				await this.endAtBoot(row, job, false, RESTART_REASON).catch((e) =>
					this.logger.warn(
						`Could not settle run ${row.id} at boot: ${(e as Error).message}`,
					),
				);
			}
		}
	}

	private async endAtBoot(
		row: { id: string; kind: string },
		job: { status: string; payload: string } | null,
		stopped: boolean,
		reason = job ? RESTART_REASON : UNQUEUED_REASON,
	): Promise<void> {
		if (job && jobResume(job.payload)) {
			await this.restoreFollowUp(
				row.id,
				FOLLOW_UP_RESTART_REASON,
				stopped ? "stopped" : "error",
			);
		} else {
			const chat = row.kind === "chat";
			await this.investigationsService.updateStatusInternal(
				row.id,
				stopped ? "cancelled" : "failed",
				undefined,
				stopped ? (chat ? "Chat stopped" : "Investigation cancelled") : reason,
			);
		}
		// The job follows the row: a stop is a cancelled job, not the restart's failure (#804 OBJ-027).
		if (stopped && job && job.status !== "cancelled")
			await this.prisma.job.updateMany({
				where: { investigationId: row.id },
				data: {
					status: "cancelled",
					claimedBy: null,
					finishedAt: new Date(),
					lastError: "Stopped before PrismaLens restarted",
				},
			});
	}

	/**
	 * Reopen a finished run for one follow-up message (#747). The live check,
	 * the compare-and-set and the job rearm are one transaction (#673 w59): two
	 * racing sends admit one, and a refused rearm leaves the row as it was.
	 * Returns false when a follow-up already holds it.
	 */
	async resumeInvestigation(
		id: string,
		text: string,
		mode: OperatorMessageMode,
		kind: FollowUpKind = "chat",
		attachments: JobAttachment[] = [],
	): Promise<boolean> {
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: {
				incidentId: true,
				status: true,
				completedAt: true,
				error: true,
				agentMode: true,
				kind: true,
				report: true,
			},
		});
		if (!row || !isWorkflowTerminal(row.status)) return false;
		if (kind === "continue") {
			if (row.kind === "chat")
				throw new FollowUpRefused(
					"A chat has no report to continue to. Ask, or start a new run to investigate.",
				);
			if (row.report !== null)
				throw new FollowUpRefused(
					"This run has its report. Investigate again starts a new run.",
				);
			if (row.status !== "cancelled" && row.status !== "failed")
				throw new FollowUpRefused(
					"Only a stopped or failed run can be continued.",
				);
		}
		// The run keeps the mode it ran in: the row's, else what its first job asked for.
		const first = row.agentMode
			? null
			: await this.prisma.job.findUnique({
					where: { investigationId: id },
					select: { payload: true },
				});
		const agentMode =
			row.agentMode ?? (first ? jobAgentMode(first.payload) : undefined);
		const sawEvidence =
			kind === "continue" &&
			(await this.prisma.investigationEvent.count({
				where: {
					investigationId: id,
					event: { contains: '"kind":"tool_result"' },
				},
			})) > 0;
		const restore = {
			status: row.status as WorkflowStatus,
			completedAt: row.completedAt?.toISOString() ?? null,
			error: row.error,
		};
		const data: InvestigationJobData = {
			incidentId: row.incidentId,
			investigationId: id,
			...(agentMode ? { agentMode } : {}),
			resume: {
				text,
				mode,
				restore,
				// Explicit on every follow-up so its intent never depends on a default.
				kind,
				...(kind === "continue" ? { sawEvidence } : {}),
				...(attachments.length ? { attachments } : {}),
			},
		};
		const admitted = await this.prisma.$transaction(async (tx) => {
			const other = await tx.investigation.findFirst({
				where: {
					incidentId: row.incidentId,
					id: { not: id },
					status: { in: [...LIVE_WORKFLOW_STATUSES] },
				},
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			});
			if (other) {
				const n = await tx.investigation.count({
					where: {
						incidentId: row.incidentId,
						createdAt: { lte: other.createdAt },
					},
				});
				throw new FollowUpRefused(
					`Run #${n} is working; message it or stop it.`,
				);
			}
			const { count } = await tx.investigation.updateMany({
				where: { id, status: row.status },
				data: {
					status: "pending",
					completedAt: null,
					error: null,
					stopRequestedAt: null,
					liveTurn: kind === "continue" ? "report" : "answer",
				},
			});
			if (count === 0) return false;
			await new PrismaJobStore(tx.job as unknown as JobDelegate).enqueue({
				investigationId: id,
				incidentId: row.incidentId,
				payload: JSON.stringify(data),
				priority: PRIORITY_ORDER.normal ?? 3,
			});
			return true;
		});
		if (!admitted) return false;
		this.streamRelay.attach(id);
		void this.dispatcher.tick();
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
		attachments: JobAttachment[] = [],
	): "queued" | "sent" | null {
		let state: "queued" | "sent" | null = null;
		this.bus.publish<RunMessageRequest>(runMessageTopic(investigationId), {
			text,
			mode,
			attachments,
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
		outcome: Extract<TurnOutcome, "stopped" | "error">,
	): Promise<boolean> {
		const job = await this.prisma.job.findUnique({
			where: { investigationId },
			select: { payload: true },
		});
		const resume = job ? jobResume(job.payload) : undefined;
		if (!resume) return false;
		const seq =
			(await this.investigationsService.lastEventSeq(investigationId)) + 1;
		// Only a live row is put back; one that already ended keeps its end (#804 OBJ-025).
		const applied = await this.investigationsService.settleFollowUp(
			investigationId,
			{
				status: resume.restore.status,
				completedAt: resume.restore.completedAt
					? new Date(resume.restore.completedAt)
					: null,
				error: resume.restore.error,
				lastTurnOutcome: outcome,
			},
			{ stopped: true },
		);
		if (!applied) return true;
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
