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
	Optional,
} from "@nestjs/common";
import { getConfig } from "@prismalens/config";
import {
	type AccessLevel,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	type ModelSource,
	resolveHarnessModel,
} from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	FollowUpKind,
	FollowUpRoute,
	InvestigationJobData,
	JobAttachment,
	OperatorMessageMode,
	RestartRecovery,
	RestartSummary,
	RunChoice,
	TurnOutcome,
	WorkflowStatus,
} from "@prismalens/contracts";
import {
	AccessLevelSchema,
	CanonicalEventSchema,
	effectiveAccess,
	InvestigationJobDataSchema,
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
	RunWorkspaceSchema,
	ScheduledRunSchema,
} from "@prismalens/contracts";
import { reapLiveHarnesses } from "@prismalens/engine";
import { HarnessService } from "../../core/harness/harness.service.js";
import { RepoSourceService } from "../../core/harness/repo-source.service.js";
import { RuntimeLifecycleService } from "../../core/lifecycle/runtime-lifecycle.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	TelemetryService,
	triggerFor,
} from "../../core/telemetry/telemetry.service.js";
import { ReportDeliveryService } from "../../modules/delivery/report-delivery.service.js";
import { GatewayService } from "../../modules/gateway/gateway.service.js";
import { IncidentsService } from "../../modules/incidents/incidents.service.js";
import { ConnectorResolverService } from "../../modules/integrations/connector-resolver.service.js";
import {
	GitCredentialService,
	pickOf,
} from "../../modules/integrations/git-credential.service.js";
import { TelemetrySnapshotService } from "../../modules/integrations/telemetry-snapshot.service.js";
import { ContextPackService } from "../../modules/investigations/context-pack.service.js";
import type { InternalInvestigationResultDto } from "../../modules/investigations/dto/index.js";
import {
	followUpRoute,
	handoffPreflight,
} from "../../modules/investigations/follow-up-route.js";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import {
	runScope,
	runScopeKey,
} from "../../modules/investigations/run-scope.js";
import { StreamRelayService } from "../../modules/investigations/stream-relay.service.js";
import {
	interruptedRunIds,
	RunWorkspacesService,
} from "../../modules/run-workspaces/run-workspaces.service.js";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import { TimelineService } from "../../modules/timeline/timeline.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { Dispatcher } from "./dispatcher.js";
import {
	EVENT_BUS,
	type EventBus,
	type MessageState,
	type RunAskRequest,
	type RunMessageRequest,
	runAskTopic,
	runCancelTopic,
	runMessageTopic,
} from "./event-bus.js";
import { containPrevious, readReceipt } from "./harness-receipt.js";
import { createInProcessRunner } from "./in-process-runner.js";
import {
	followUpNotDelivered,
	runDirFor,
	sweepRunWorkspaces,
} from "./investigation-run.js";
import {
	type JobDelegate,
	type JobStore,
	PrismaJobStore,
} from "./job-store.js";
import {
	BOOT_LOOP_MS,
	lastActivityOf,
	NOT_RESUMED,
	notResumedReason,
	RECOVERY_DELAY_MS,
} from "./restart-recovery.js";
import type { RunPorts } from "./run-ports.js";

export type { InvestigationJobData };

/** What boot reads before it writes anything, to decide which cut-off runs resume (#981). */
interface BootContext {
	now: Date;
	/** When PrismaLens was last alive before this start. */
	stoppedAt: Date;
	bootLoop: boolean;
	enabled: boolean;
	activity: Map<string, Date>;
	/** The run's agent from before the stop is proven gone. */
	contained: Map<string, boolean>;
	/** Workspaces the boot sweep must leave: resumed runs, and runs whose agent may live. */
	keep: Set<string>;
	resumed: string[];
	skipped: { id: string; reason: string }[];
}

const RESTART_SUMMARY_KEY = "runtime.lastRecovery";

/** A follow-up the run's state rules out; the controller answers CONFLICT with it. */
export class FollowUpRefused extends Error {}

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

/** An unlinked check's frozen subject and brief from its stored snapshot, for its follow-up job (#979). */
function serviceCheckOf(
	snapshot: string | null,
): Pick<InvestigationJobData, "scheduled" | "brief"> {
	try {
		const raw = JSON.parse(snapshot ?? "null") as { brief?: unknown } | null;
		const scheduled = ScheduledRunSchema.safeParse(raw);
		if (!scheduled.success) return {};
		return {
			scheduled: scheduled.data,
			...(typeof raw?.brief === "string" ? { brief: raw.brief } : {}),
		};
	} catch {
		return {};
	}
}

/**
 * The model a run asks for and where it came from. A harness that cannot take
 * a model never gets here with one set: the selection refused it first
 * (`refuseModel`, #639 rec 4), and it never claims a `modelSource`.
 */
/** PrismaLens started the run on its own (the trigger service's types); a person's is `manual` or none. */
function startedByAlert(triggerType: string | null): boolean {
	return !!triggerType && triggerType !== "manual";
}

function agentLabel(harness: string | null): string {
	const id = HARNESS_IDS.find((h) => h === harness);
	return id ? HARNESS_REGISTRY[id].label : "The agent";
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * The interrupted job again, as a follow-up of the same turn: its pins (agent,
 * model, level, `unattended`) are the job's own, never a person's (#981, #818).
 */
export function recoveryPayload(
	original: InvestigationJobData,
	plan: { route: FollowUpRoute; harness: HarnessId },
	turn: "report" | "answer",
	restart: RestartRecovery,
	sawEvidence = false,
): InvestigationJobData {
	const { resume: prev, ...rest } = original;
	// An answer is asked again in the agent's own words; a report turn just carries on.
	const question =
		turn === "answer" ? (prev ? prev.text : original.chat?.text) : undefined;
	return {
		...rest,
		resume: {
			text: question ?? "PrismaLens restarted.",
			mode: "queue",
			kind: turn === "report" ? "continue" : "chat",
			// Evidence from before the stop counts, or a report-only resume fails as "no tool ran" (#981).
			...(turn === "report" ? { sawEvidence } : {}),
			restore: prev?.restore ?? {
				status: "failed",
				completedAt: null,
				error: RESTART_REASON,
			},
			to: { ...(prev?.to ?? {}), harness: plan.harness },
			...(plan.route === "handoff" ? { handoff: true } : {}),
			restart,
		},
	};
}

export function resolveHarnessRunModel(
	harnessId: HarnessId,
	operatorModel: string | undefined,
	agentEnv: Record<string, string> = {},
): { model?: string; modelSource?: ModelSource } {
	if (HARNESS_REGISTRY[harnessId].modelVia === "unsupported") return {};
	const resolved = resolveHarnessModel(harnessId, operatorModel, {
		...process.env,
		...agentEnv,
	});
	return {
		...(resolved.model ? { model: resolved.model } : {}),
		modelSource: resolved.source,
	};
}

/** The run's model is one the operator added in Settings, Agent (#673 w57). */
export function isCustomModel(
	model: { model?: string; modelSource?: ModelSource },
	custom: readonly string[] | undefined,
): boolean {
	return (
		model.modelSource === "operator" &&
		!!model.model &&
		!!custom?.includes(model.model)
	);
}

@Injectable()
export class DispatchService implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(DispatchService.name);
	private readonly store: JobStore;
	private readonly dispatcher: Dispatcher;
	private recoveryWake: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@Inject(EVENT_BUS) private readonly bus: EventBus,
		private readonly streamRelay: StreamRelayService,
		private readonly investigationsService: InvestigationsService,
		private readonly incidentsService: IncidentsService,
		private readonly timelineService: TimelineService,
		private readonly harnessService: HarnessService,
		private readonly repoSource: RepoSourceService,
		private readonly prisma: PrismaService,
		private readonly gitCredentials: GitCredentialService,
		private readonly connectorResolver: ConnectorResolverService,
		private readonly contextPackService: ContextPackService,
		private readonly telemetry: TelemetryService,
		private readonly reportDelivery: ReportDeliveryService,
		@Optional() private readonly gateway?: GatewayService,
		@Optional() telemetrySnapshot?: TelemetrySnapshotService,
		@Optional() private readonly runWorkspaces?: RunWorkspacesService,
		@Optional() private readonly lifecycle?: RuntimeLifecycleService,
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
							report: investigation.report ?? null,
						}
					: null;
			},
			events: (id) => this.investigationsService.allEvents(id),
			recordHandoff: async (id, to) => {
				await this.prisma.investigation.update({
					where: { id },
					data: {
						harness: to.harness,
						model: to.model,
						effort: to.effort,
						acpSessionId: to.acpSessionId,
						usage: null,
					},
				});
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
						accessLevel: dto.accessLevel,
						lastTurnOutcome: dto.lastTurnOutcome,
						endReason: dto.endReason,
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
						...(state.workspace !== undefined
							? { workspace: state.workspace }
							: {}),
					},
				});
			},
			recordSession: async (id, acpSessionId) => {
				await this.prisma.investigation.update({
					where: { id },
					data: { acpSessionId },
				});
			},
			recordUsage: async (id, usage) => {
				await this.prisma.investigation.updateMany({
					where: { id },
					data: { usage: JSON.stringify(usage) },
				});
			},
			markAwaitingApproval: async (id, since) => {
				await this.prisma.investigation.updateMany({
					where: { id },
					data: { awaitingApprovalAt: since },
				});
			},
			newerRun: async (id) => {
				const self = await this.prisma.investigation.findUnique({
					where: { id },
					select: { incidentId: true, scheduleId: true, createdAt: true },
				});
				if (!self) return null;
				const newer = await this.prisma.investigation.findFirst({
					where: {
						...runScope(self),
						createdAt: { gt: self.createdAt },
						workspace: { not: null },
					},
					orderBy: { createdAt: "desc" },
					select: { createdAt: true, workspace: true },
				});
				const ws = newer?.workspace
					? RunWorkspaceSchema.safeParse(JSON.parse(newer.workspace))
					: null;
				if (!newer || !ws?.success || ws.data.repos.length === 0) return null;
				const number = await this.prisma.investigation.count({
					where: {
						...runScope(self),
						createdAt: { lte: newer.createdAt },
					},
				});
				return {
					number,
					heads: ws.data.repos.map((r) => ({ name: r.name, head: r.head })),
				};
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
			agentRuntime: (id) => this.harnessService.runtimeFor(id),
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
			snapshotWith: async (ref, dest, signal, at, runId, onOutput) => {
				signal?.throwIfAborted();
				const row =
					ref.sourceKind === "url"
						? await this.prisma.repository.findFirst({
								where: { url: ref.url },
								select: { metadata: true },
							})
						: null;
				const { result: snap, credential } =
					await this.gitCredentials.withCredential(
						{
							sourceKind: ref.sourceKind,
							url: ref.url,
							connectionId: ref.connectionId,
							pick: pickOf(row?.metadata),
						},
						(cred) =>
							this.repoSource.snapshot(
								{
									kind: ref.sourceKind,
									source: ref.url,
									defaultBranch: ref.defaultBranch,
									credential: cred,
								},
								dest,
								signal,
								at,
								runId,
								onOutput,
							),
						signal,
					);
				const { problem: _problem, ...run } = credential;
				return { snap, credential: run };
			},
			getIncident: async (id) => {
				const incident = await this.incidentsService.findById(id);
				return incident as unknown as Record<string, unknown> | null;
			},
			restartAlerts: (incidentId, since, until, stoppedAt) =>
				this.restartAlerts(incidentId, since, until, stoppedAt),
			resolveConnectors: (serviceId) =>
				this.connectorResolver.resolve({ serviceId }),
			contextPack: (subject) =>
				typeof subject === "string"
					? this.contextPackService.assemble(subject)
					: this.contextPackService.assembleForService(subject.serviceId),
			deployments: async (services) => {
				const rows = await this.prisma.changeEvent.findMany({
					where: {
						type: { in: ["deploy", "deployment"] },
						service: { name: { in: services } },
					},
					orderBy: { timestamp: "desc" },
					take: 50,
					select: { metadata: true },
				});
				return rows.flatMap((r) => {
					const meta = safeParseJsonObject(r.metadata ?? null) ?? {};
					const sha = meta.sha ?? meta.commit;
					const name = meta.version ?? meta.tag;
					return typeof sha === "string"
						? [{ sha, name: typeof name === "string" ? name : null }]
						: [];
				});
			},
			...(this.gateway ? { gateway: this.gateway } : {}),
			...(telemetrySnapshot
				? {
						preRun: {
							telemetry: (subject, window, signal) =>
								typeof subject === "string"
									? telemetrySnapshot.fetch(subject, window, signal)
									: telemetrySnapshot.fetchForService(
											subject.serviceId,
											window,
											signal,
										),
							runbooks: (runId, signal) =>
								this.gateway?.runbookIndex(runId, signal) ??
								Promise.resolve({ entries: [] }),
							save: async (runId, snapshot) => {
								await this.prisma.investigation.update({
									where: { id: runId },
									data: { preRun: snapshot },
								});
							},
							load: async (runId) =>
								(
									await this.prisma.investigation.findUnique({
										where: { id: runId },
										select: { preRun: true },
									})
								)?.preRun ?? null,
						},
					}
				: {}),
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
		const runtime = await this.harnessService.runtimeFor(h);
		const local = this.harnessService.localDefaultOf(h, runtime.env);
		const model = resolveHarnessRunModel(
			h,
			pick(requested.model, settings.models?.[h]),
			runtime.env,
		);
		return {
			selection,
			...model,
			...(effort ? { effort } : {}),
			accessLevel: effectiveAccess(settings, h, local.permission).level,
			...(isCustomModel(model, settings.customModels?.[h])
				? { customModel: true }
				: {}),
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
		// Read before any boot write: what each cut-off run last did, and whether its agent is gone (#981).
		const boot = await this.bootContext().catch((e) => {
			this.logger.warn(
				`Could not read the runs a stop cut off: ${(e as Error).message}`,
			);
			return null;
		});
		// An API restart abandons whatever was `running`. Each cut-off run is taken
		// up again or settled against its job before the loop starts (#981).
		await this.denyAsksLeftWaiting().catch((e) =>
			this.logger.warn(
				`Could not settle asks left waiting at boot: ${(e as Error).message}`,
			),
		);
		await this.markQueuedLeftWaiting().catch((e) =>
			this.logger.warn(
				`Could not settle messages left queued at boot: ${(e as Error).message}`,
			),
		);
		const ids = await this.store.failRunning(RESTART_REASON);
		if (ids.length > 0) {
			this.logger.warn(
				`Failed ${ids.length} investigation(s) left running by a previous process: ${ids.join(", ")}`,
			);
		}
		await this.reconcileLiveRows(new Set(ids), boot).catch((e) =>
			this.logger.warn(
				`Could not reconcile live runs at boot: ${(e as Error).message}`,
			),
		);
		if (boot)
			await this.revalidateRecoveries(boot).catch((e) =>
				this.logger.warn(
					`Could not re-check recoveries left pending: ${(e as Error).message}`,
				),
			);
		// The boot sweep applies each workspace's own retention rule, so the settings load first.
		await this.runWorkspaces?.ready();
		try {
			const interrupted = await interruptedRunIds(this.prisma);
			// A follow-up resumeInvestigation left pending reuses its run's workspace.
			const live = await this.prisma.investigation.findMany({
				where: { status: { in: ["pending", "running"] } },
				select: { id: true },
			});
			const liveIds = new Set(live.map((r) => r.id));
			const swept = await sweepRunWorkspaces({
				isLive: (id) => liveIds.has(id) || !!boot?.keep.has(id),
				isInterrupted: (id) => interrupted.has(id),
			});
			if (swept > 0)
				this.logger.warn(`Removed the leftover workspaces of ${swept} run(s)`);
		} catch (e) {
			this.logger.warn("Could not sweep leftover run workspaces", e);
		}
		if (boot)
			await this.writeRestartSummary(boot).catch((e) =>
				this.logger.warn(
					`Could not record what this start resumed: ${(e as Error).message}`,
				),
			);
		this.dispatcher.start();
		// The loop has no poll timer: a recovery waiting out its delay is claimed only by a tick (#981).
		if (boot?.resumed.length)
			this.recoveryWake = setTimeout(
				() => void this.dispatcher.tick(),
				RECOVERY_DELAY_MS + 1_000,
			).unref();
		this.logger.log(
			`Dispatch loop started, concurrency cap ${getConfig().PRISMALENS_DISPATCH_CONCURRENCY}, owner ${this.dispatcher.ownerToken}`,
		);
	}

	async onApplicationShutdown(): Promise<void> {
		clearTimeout(this.recoveryWake);
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
	/** A run whose job a schedule committed in its own transaction (#979): open its relay and wake the loop. */
	startAdmitted(investigationId: string): void {
		this.streamRelay.attach(investigationId);
		void this.dispatcher.tick();
	}

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
	private async reconcileLiveRows(
		wasRunning: Set<string>,
		boot: BootContext | null = null,
	): Promise<void> {
		await this.settleJobsOfEndedRows(wasRunning);
		const rows = await this.prisma.investigation.findMany({
			where: { status: { in: [...LIVE_WORKFLOW_STATUSES] } },
			select: {
				id: true,
				incidentId: true,
				scheduleId: true,
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
			if (!stopped && job && boot) {
				const verdict = await this.tryRecover(row.id, boot).catch(
					(e: Error) => `it could not be prepared: ${e.message}`,
				);
				if (verdict === true) {
					waiting.push(row);
					continue;
				}
				if (verdict !== null) {
					boot.skipped.push({ id: row.id, reason: verdict });
					await this.endAtBoot(row, job, false, undefined, verdict).catch((e) =>
						this.logger.warn(
							`Could not settle run ${row.id} at boot: ${(e as Error).message}`,
						),
					);
					continue;
				}
			}
			await this.endAtBoot(row, job, stopped).catch((e) =>
				this.logger.warn(
					`Could not settle run ${row.id} at boot: ${(e as Error).message}`,
				),
			);
		}
		// Old data can hold two live rows on one incident (or schedule): the newest keeps its claim.
		const byScope = new Map<string, typeof rows>();
		for (const row of waiting) {
			const key = runScopeKey(row);
			byScope.set(key, [...(byScope.get(key) ?? []), row]);
		}
		for (const [scope, live] of byScope) {
			if (live.length < 2) continue;
			this.logger.warn(
				`${scope} had ${live.length} live runs; keeping the newest`,
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

	/**
	 * An ask whose agent died with the last process is denied (#673 w21): the
	 * conversation says so and the row stops waiting, before the run itself is settled.
	 */
	private async denyAsksLeftWaiting(): Promise<void> {
		// A shutdown clears awaitingApprovalAt as it closes the asks, so live rows are read too (#820).
		const rows = await this.prisma.investigation.findMany({
			where: {
				OR: [
					{ awaitingApprovalAt: { not: null } },
					{ status: { in: [...LIVE_WORKFLOW_STATUSES] } },
				],
			},
			select: { id: true, awaitingApprovalAt: true },
		});
		let denied = 0;
		for (const { id, awaitingApprovalAt } of rows) {
			const events = await this.prisma.investigationEvent.findMany({
				where: {
					investigationId: id,
					event: { contains: '"kind":"permission_' },
				},
				orderBy: { seq: "asc" },
				select: { event: true },
			});
			const open = new Map<string, string>();
			for (const row of events) {
				const parsed = CanonicalEventSchema.safeParse(JSON.parse(row.event));
				const e = parsed.success ? parsed.data : null;
				if (e?.kind === "permission_ask") open.set(e.askId, e.branchId);
				else if (e?.kind === "permission_answer") open.delete(e.askId);
			}
			if (open.size === 0 && !awaitingApprovalAt) continue;
			if (open.size > 0) denied++;
			let seq = (await this.investigationsService.lastEventSeq(id)) + 1;
			const ts = new Date().toISOString();
			await this.investigationsService.appendEvents(
				id,
				[...open].map(([askId, branchId]) => ({
					kind: "permission_answer" as const,
					runId: id,
					branchId,
					path: [],
					seq: seq++,
					label: null,
					ts,
					askId,
					outcome: "restarted" as const,
				})),
			);
			await this.prisma.investigation.update({
				where: { id },
				data: { awaitingApprovalAt: null },
			});
		}
		if (denied)
			this.logger.warn(
				`Denied the asks of ${denied} run(s) left waiting by a previous process`,
			);
	}

	/**
	 * A message queued on a run the last process held never reached it (#820):
	 * the conversation says it was not delivered instead of showing it waiting.
	 */
	private async markQueuedLeftWaiting(): Promise<void> {
		const rows = await this.prisma.investigation.findMany({
			where: { status: { in: [...LIVE_WORKFLOW_STATUSES] } },
			select: { id: true },
		});
		for (const { id } of rows) {
			const events = await this.prisma.investigationEvent.findMany({
				where: { investigationId: id, event: { contains: '"messageId"' } },
				orderBy: { seq: "asc" },
				select: { event: true },
			});
			const open = new Map<
				string,
				Extract<CanonicalEvent, { kind: "message_queued" }>
			>();
			for (const row of events) {
				const parsed = CanonicalEventSchema.safeParse(JSON.parse(row.event));
				const e = parsed.success ? parsed.data : null;
				if (e?.kind === "message_queued") open.set(e.messageId, e);
				else if (e?.kind === "operator_message" && e.messageId)
					open.delete(e.messageId);
			}
			if (open.size === 0) continue;
			let seq = (await this.investigationsService.lastEventSeq(id)) + 1;
			const ts = new Date().toISOString();
			await this.investigationsService.appendEvents(
				id,
				[...open.values()].map((q) => ({
					kind: "operator_message" as const,
					runId: id,
					branchId: q.branchId,
					path: [],
					seq: seq++,
					label: null,
					ts,
					text: q.text,
					mode: "queue" as const,
					delivered: false,
					messageId: q.messageId,
					...(q.attachments?.length ? { attachments: q.attachments } : {}),
				})),
			);
		}
	}

	/**
	 * A run that wrote its row's end and died before its job did: the job
	 * failRunning just failed takes the row's outcome (#804 OBJ-027).
	 */
	private async settleJobsOfEndedRows(wasRunning: Set<string>): Promise<void> {
		if (wasRunning.size === 0) return;
		const ended = await this.prisma.investigation.findMany({
			where: {
				id: { in: [...wasRunning] },
				status: { notIn: [...LIVE_WORKFLOW_STATUSES] },
			},
			select: { id: true, status: true, lastTurnOutcome: true },
		});
		for (const row of ended) {
			const job = await this.prisma.job.findUnique({
				where: { investigationId: row.id },
				select: { payload: true },
			});
			const followUp = !!job && !!jobResume(job.payload);
			const outcome = followUp
				? row.lastTurnOutcome === "stopped"
					? "cancelled"
					: row.lastTurnOutcome === "answered"
						? "succeeded"
						: "failed"
				: row.status === "cancelled"
					? "cancelled"
					: row.status === "completed"
						? "succeeded"
						: "failed";
			if (outcome === "failed") continue;
			await this.prisma.job.updateMany({
				where: { investigationId: row.id, status: "failed" },
				data: {
					status: outcome,
					lastError:
						outcome === "cancelled"
							? "Stopped before PrismaLens restarted"
							: null,
				},
			});
		}
	}

	private async endAtBoot(
		row: { id: string; kind: string },
		job: { status: string; payload: string } | null,
		stopped: boolean,
		reason = job ? RESTART_REASON : UNQUEUED_REASON,
		notResumed?: string,
	): Promise<void> {
		if (job && jobResume(job.payload)) {
			await this.restoreFollowUp(
				row.id,
				notResumed
					? `${FOLLOW_UP_RESTART_REASON} ${NOT_RESUMED}${notResumed}`
					: FOLLOW_UP_RESTART_REASON,
				stopped ? "stopped" : "error",
			);
			// A recovery that fell back to the interrupted standing says why it went no further.
			if (notResumed)
				await this.prisma.investigation.updateMany({
					where: { id: row.id, status: "failed", endReason: "interrupted" },
					data: { error: `${NOT_RESUMED}${notResumed}` },
				});
		} else {
			const chat = row.kind === "chat";
			await this.investigationsService.updateStatusInternal(
				row.id,
				stopped ? "cancelled" : "failed",
				undefined,
				stopped
					? chat
						? "Chat stopped"
						: "Investigation cancelled"
					: notResumed
						? `${NOT_RESUMED}${notResumed}`
						: reason,
				undefined,
				stopped || !job ? undefined : { endReason: "interrupted" },
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
		to: RunChoice = {},
	): Promise<boolean> {
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: {
				incidentId: true,
				scheduleId: true,
				configSnapshot: true,
				status: true,
				completedAt: true,
				error: true,
				accessLevel: true,
				kind: true,
				report: true,
				triggerType: true,
				harness: true,
				model: true,
				acpSessionId: true,
				endReason: true,
			},
		});
		if (!row || !isWorkflowTerminal(row.status)) return false;
		const plan = await this.planFollowUp(row, to);
		if (!plan) throw new FollowUpRefused("Pick an agent to continue in.");
		if (plan.preflight)
			throw new FollowUpRefused(
				`${plan.preflight.problem} ${plan.preflight.fix}`,
			);
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
		const accessLevel = await this.followUpLevel(row);
		const sawEvidence = kind === "continue" && (await this.hasToolResult(id));
		const restore = {
			status: row.status as WorkflowStatus,
			completedAt: row.completedAt?.toISOString() ?? null,
			error: row.error,
		};
		const data: InvestigationJobData = {
			incidentId: row.incidentId,
			investigationId: id,
			...(row.incidentId ? {} : serviceCheckOf(row.configSnapshot)),
			...(accessLevel ? { accessLevel } : {}),
			resume: {
				text,
				mode,
				restore,
				// Explicit on every follow-up so its intent never depends on a default.
				kind,
				...(kind === "continue" ? { sawEvidence } : {}),
				...(attachments.length ? { attachments } : {}),
				to: { ...to, harness: plan.harness },
				...(plan.route === "handoff" ? { handoff: true } : {}),
				...((await this.afterRestart(id, row.endReason))
					? { afterRestart: true }
					: {}),
			},
		};
		const admitted = await this.prisma.$transaction(async (tx) => {
			const other = await tx.investigation.findFirst({
				where: {
					...runScope(row),
					id: { not: id },
					status: { in: [...LIVE_WORKFLOW_STATUSES] },
				},
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			});
			if (other) {
				const n = await tx.investigation.count({
					where: {
						...runScope(row),
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
	 * The run keeps the level it asked for; a row from before levels keeps the session's mode (#673 w21).
	 * A person's follow-up on an alert-started run takes the person's level, not its Auto (#818).
	 */
	async followUpLevel(row: {
		triggerType: string | null;
		harness: string | null;
		accessLevel: string | null;
	}): Promise<AccessLevel | undefined> {
		const alertHarness =
			startedByAlert(row.triggerType) &&
			HARNESS_IDS.find((h) => h === row.harness);
		return alertHarness
			? (await this.harnessService.effectiveChoice(alertHarness)).accessLevel
			: AccessLevelSchema.safeParse(row.accessLevel).data;
	}

	/** A restart cut the run off and no follow-up has run since, so the agent must be told. */
	async afterRestart(id: string, endReason: string | null): Promise<boolean> {
		if (endReason !== "interrupted") return false;
		const followUps = await this.prisma.investigationEvent.count({
			where: { investigationId: id, event: { contains: '"resumed":[' } },
		});
		return followUps === 0;
	}

	/**
	 * Where a finished run's follow-up goes and whether the recipient can take
	 * it: installed, signed in where the last check says, and the model accepted.
	 */
	async planFollowUp(
		row: {
			harness: string | null;
			acpSessionId: string | null;
			model: string | null;
		},
		to: RunChoice,
	): Promise<{
		route: FollowUpRoute;
		harness: HarnessId;
		preflight: { problem: string; fix: string } | null;
	} | null> {
		const plan = followUpRoute(row, to.harness);
		if (!plan) return null;
		const model =
			to.model !== undefined
				? to.model
				: plan.harness === row.harness
					? row.model
					: undefined;
		const selection = await this.harnessService.resolveSelection({
			harness: plan.harness,
			...(model !== undefined ? { model } : {}),
		});
		return {
			...plan,
			preflight: handoffPreflight(
				plan.harness,
				selection,
				this.harnessService.checkedOutcome(plan.harness),
			),
		};
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
		kind?: FollowUpKind,
		id?: string,
	): MessageState {
		let state: MessageState = null;
		this.bus.publish<RunMessageRequest>(runMessageTopic(investigationId), {
			text,
			mode,
			attachments,
			...(kind ? { kind } : {}),
			...(id ? { id } : {}),
			reply: (s) => {
				state = s;
			},
		});
		return state;
	}

	/** The operator's Approve or Deny for a live run's ask (#673 w21); null when it no longer waits. */
	answerAsk(
		investigationId: string,
		askId: string,
		approve: boolean,
	): "approved" | "denied" | null {
		let outcome: "approved" | "denied" | null = null;
		this.bus.publish<RunAskRequest>(runAskTopic(investigationId), {
			askId,
			approve,
			reply: (o) => {
				outcome = o;
			},
		});
		return outcome;
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
	/** The boot's view of the cut-off runs, read before any boot write (#981 OBJ-006, OBJ-010). */
	private async bootContext(): Promise<BootContext> {
		const now = new Date();
		const live = await this.prisma.investigation.findMany({
			where: { status: { in: [...LIVE_WORKFLOW_STATUSES] } },
			select: { id: true },
		});
		const activity = new Map<string, Date>();
		const contained = new Map<string, boolean>();
		const keep = new Set<string>();
		for (const { id } of live) {
			activity.set(id, await this.lastActivity(id, now));
			const gone = await containPrevious(readReceipt(runDirFor(id))).catch(
				() => false,
			);
			contained.set(id, gone);
			if (!gone) keep.add(id);
		}
		const prev = this.lifecycle?.lastRestart()?.previous ?? null;
		const last = await this.restartSummary().catch(() => null);
		const bootLoop =
			!!prev &&
			prev.lastAliveAt.getTime() - prev.startedAt.getTime() < BOOT_LOOP_MS &&
			!!last &&
			last.resumed.length > 0 &&
			Date.parse(last.at) >= prev.startedAt.getTime() - 5_000;
		const latest = Math.max(
			0,
			...[...activity.values()].map((d) => d.getTime()),
		);
		return {
			now,
			stoppedAt: prev?.lastAliveAt ?? (latest ? new Date(latest) : now),
			bootLoop,
			enabled: await this.harnessService.resumeAfterRestart().catch(() => true),
			activity,
			contained,
			keep,
			resumed: [],
			skipped: [],
		};
	}

	private async hasToolResult(id: string): Promise<boolean> {
		return (
			(await this.prisma.investigationEvent.count({
				where: {
					investigationId: id,
					event: { contains: '"kind":"tool_result"' },
				},
			})) > 0
		);
	}

	/** The run's newest event the boot did not write itself. */
	private async lastActivity(id: string, fallback: Date): Promise<Date> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: { investigationId: id },
			orderBy: { createdAt: "desc" },
			take: 200,
			select: { createdAt: true, event: true },
		});
		return lastActivityOf(rows, fallback);
	}

	/**
	 * Takes up a cut-off run in one transaction with ending its turn (#981 OBJ-001):
	 * true when re-armed, the reason when it is left for the operator, null when its
	 * turn had already finished and it is settled as before.
	 */
	private async tryRecover(
		id: string,
		boot: BootContext,
	): Promise<true | string | null> {
		const found = await this.recoverable(id);
		if (!found) return null;
		const { inv, job, original, turn } = found;
		if (await this.finishedTurn(id, job.claimedAt, turn)) return null;
		const lastActivityAt = boot.activity.get(id) ?? boot.now;
		const prior = original.resume?.restart;
		const plan = await this.planFollowUp(inv, {});
		const reason = notResumedReason({
			enabled: boot.enabled,
			now: boot.now,
			lastActivityAt,
			attempt: (prior?.attempt ?? 0) + 1,
			bootLoop: boot.bootLoop,
			contained: boot.contained.get(id) ?? true,
			agent: agentLabel(plan?.harness ?? inv.harness),
			preflight: !plan
				? "it names no agent to resume in."
				: plan.preflight
					? `${plan.preflight.problem} ${plan.preflight.fix}`
					: null,
		});
		if (reason || !plan) return reason ?? "it names no agent to resume in.";
		const data = recoveryPayload(
			original,
			plan,
			turn,
			{
				attempt: (prior?.attempt ?? 0) + 1,
				stoppedAt: boot.stoppedAt.toISOString(),
				lastActivityAt: lastActivityAt.toISOString(),
				by: "auto",
			},
			await this.hasToolResult(id),
		);
		const admitted = await this.rearm(
			id,
			inv.incidentId,
			turn,
			data,
			new Date(boot.now.getTime() + RECOVERY_DELAY_MS),
			"live",
		);
		if (!admitted) return "it changed while PrismaLens was starting.";
		boot.keep.add(id);
		boot.resumed.push(id);
		this.streamRelay.attach(id);
		return true;
	}

	/** The run, its job and the turn the job was running; null when there is nothing to take up. */
	private async recoverable(id: string) {
		const inv = await this.prisma.investigation.findUnique({
			where: { id },
			select: {
				incidentId: true,
				kind: true,
				harness: true,
				model: true,
				acpSessionId: true,
				status: true,
				endReason: true,
			},
		});
		const job = await this.prisma.job.findUnique({
			where: { investigationId: id },
			select: { payload: true, claimedAt: true, priority: true },
		});
		if (!inv || !job) return null;
		const parsed = InvestigationJobDataSchema.safeParse(safeJson(job.payload));
		if (!parsed.success) return null;
		const original = parsed.data;
		const turn: "report" | "answer" = original.resume
			? original.resume.kind === "continue"
				? "report"
				: "answer"
			: inv.kind === "chat"
				? "answer"
				: "report";
		return { inv, job, original, turn };
	}

	/** A turn whose end the run had already recorded before the stop is not re-run (#981 OBJ-004). */
	private async finishedTurn(
		id: string,
		since: Date | null,
		turn: "report" | "answer",
	): Promise<boolean> {
		if (!since) return false;
		const ends = await this.prisma.investigationEvent.count({
			where: {
				investigationId: id,
				createdAt: { gte: since },
				OR: [
					{ event: { contains: '"kind":"report"' } },
					...(turn === "answer"
						? [{ event: { contains: '"kind":"branch_done"' } }]
						: []),
				],
			},
		});
		return ends > 0;
	}

	/**
	 * The row goes pending and its job is re-armed in one transaction, so a crash
	 * between them leaves either the cut-off run or a pending recovery, never neither.
	 */
	private async rearm(
		id: string,
		incidentId: string,
		turn: "report" | "answer",
		data: InvestigationJobData,
		runAt: Date,
		from: "live" | "interrupted",
	): Promise<boolean> {
		return this.prisma.$transaction(async (tx) => {
			const { count } = await tx.investigation.updateMany({
				where:
					from === "live"
						? { id, status: { in: [...LIVE_WORKFLOW_STATUSES] } }
						: { id, status: "failed", endReason: "interrupted" },
				data: {
					status: "pending",
					completedAt: null,
					error: null,
					stopRequestedAt: null,
					endReason: "interrupted",
					liveTurn: turn,
				},
			});
			if (count === 0) return false;
			await new PrismaJobStore(tx.job as unknown as JobDelegate).enqueue({
				investigationId: id,
				incidentId,
				payload: JSON.stringify(data),
				priority: PRIORITY_ORDER[data.priority ?? "normal"] ?? 3,
				runAt,
			});
			return true;
		});
	}

	/**
	 * A recovery an earlier boot re-armed but never started is checked again against
	 * this boot's rules before it may run (#981 OBJ-013).
	 */
	private async revalidateRecoveries(boot: BootContext): Promise<void> {
		const pending = await this.prisma.job.findMany({
			where: { status: "pending" },
			select: { investigationId: true, payload: true },
		});
		for (const job of pending) {
			const id = job.investigationId;
			const restart = jobResume(job.payload)?.restart;
			if (!restart || boot.resumed.includes(id)) continue;
			const inv = await this.prisma.investigation.findUnique({
				where: { id },
				select: { harness: true, model: true, acpSessionId: true },
			});
			const plan = inv ? await this.planFollowUp(inv, {}) : null;
			const reason = notResumedReason({
				enabled: boot.enabled,
				now: boot.now,
				lastActivityAt:
					boot.activity.get(id) ?? new Date(restart.lastActivityAt),
				attempt: restart.attempt,
				bootLoop: boot.bootLoop,
				contained: boot.contained.get(id) ?? true,
				agent: agentLabel(plan?.harness ?? inv?.harness ?? null),
				preflight: plan?.preflight
					? `${plan.preflight.problem} ${plan.preflight.fix}`
					: null,
			});
			if (!reason) {
				await this.prisma.job.updateMany({
					where: { investigationId: id, status: "pending" },
					data: { runAt: new Date(boot.now.getTime() + RECOVERY_DELAY_MS) },
				});
				boot.keep.add(id);
				boot.resumed.push(id);
				this.streamRelay.attach(id);
				continue;
			}
			boot.skipped.push({ id, reason });
			await this.restoreFollowUp(
				id,
				`${FOLLOW_UP_RESTART_REASON} ${NOT_RESUMED}${reason}`,
				"error",
			);
			await this.cancelPendingJob(id);
			await this.prisma.investigation.updateMany({
				where: { id, status: "failed", endReason: "interrupted" },
				data: { error: `${NOT_RESUMED}${reason}` },
			});
		}
	}

	private async writeRestartSummary(boot: BootContext): Promise<void> {
		const ids = [...boot.resumed, ...boot.skipped.map((s) => s.id)];
		const rows = await this.prisma.investigation.findMany({
			where: { id: { in: ids } },
			select: {
				id: true,
				incidentId: true,
				incident: { select: { number: true, title: true } },
			},
		});
		const ref = (id: string) => {
			const r = rows.find((x) => x.id === id);
			return {
				investigationId: id,
				incidentId: r?.incidentId ?? "",
				incidentNumber: r?.incident?.number ?? null,
				title: r?.incident?.title ?? "",
			};
		};
		const summary: NonNullable<RestartSummary> = {
			at: boot.now.toISOString(),
			stoppedAt: this.lifecycle?.lastRestart()?.previous
				? boot.stoppedAt.toISOString()
				: null,
			resumed: boot.resumed.map(ref),
			skipped: boot.skipped.map((s) => ({ ...ref(s.id), reason: s.reason })),
		};
		await this.prisma.setting.upsert({
			where: { key: RESTART_SUMMARY_KEY },
			update: { value: JSON.stringify(summary), type: "json" },
			create: {
				key: RESTART_SUMMARY_KEY,
				value: JSON.stringify(summary),
				type: "json",
				category: "general",
			},
		});
	}

	/**
	 * Alerts on the incident that fired, arrived or resolved in the gap, and whether the
	 * boot's alert catch-up has run since the stop; "none" when there is no source to pull (#981 OBJ-008).
	 */
	private async restartAlerts(
		incidentId: string,
		since: Date,
		until: Date,
		stoppedAt: Date,
	) {
		const inGap = { gte: since, lte: until };
		const rows = await this.prisma.alert.findMany({
			where: {
				incidentId,
				OR: [
					{ triggeredAt: inGap },
					{ createdAt: inGap },
					{ resolvedAt: inGap },
				],
			},
			select: {
				title: true,
				triggeredAt: true,
				createdAt: true,
				resolvedAt: true,
			},
			orderBy: { triggeredAt: "asc" },
		});
		const within = (d: Date | null) =>
			!!d && d.getTime() >= since.getTime() && d.getTime() <= until.getTime();
		const fired = rows
			.filter((a) => within(a.triggeredAt) || within(a.createdAt))
			.map((a) => ({
				title: a.title,
				at: within(a.triggeredAt) ? a.triggeredAt : a.createdAt,
			}));
		const resolved = rows
			.filter((a) => within(a.resolvedAt))
			.map((a) => ({ title: a.title, at: a.resolvedAt as Date }));
		const sources = await this.prisma.connection.count({
			where: {
				status: "ACTIVE",
				integration: { templateId: { in: ["prometheus", "alertmanager"] } },
			},
		});
		const pulled = await this.prisma.setting
			.findUnique({ where: { key: "ALERT_PULL" } })
			.then((r) => {
				const at = r
					? (JSON.parse(r.value) as { lastPulledAt?: string }).lastPulledAt
					: undefined;
				return at ? Date.parse(at) : 0;
			})
			.catch(() => 0);
		const catchUp: "done" | "unchecked" | "none" =
			sources === 0
				? "none"
				: pulled > stoppedAt.getTime()
					? "done"
					: "unchecked";
		return { catchUp, fired, resolved };
	}

	/** What the last start did with the runs a stop cut off (#981). */
	async restartSummary(): Promise<RestartSummary> {
		const row = await this.prisma.setting.findUnique({
			where: { key: RESTART_SUMMARY_KEY },
		});
		if (!row) return null;
		try {
			return JSON.parse(row.value) as RestartSummary;
		} catch {
			return null;
		}
	}

	/** Resume, pressed on a run a restart cut off that PrismaLens left for the operator (#981). */
	async resumeInterrupted(id: string): Promise<void> {
		const found = await this.recoverable(id);
		if (
			!found ||
			found.inv.status !== "failed" ||
			found.inv.endReason !== "interrupted"
		)
			throw new FollowUpRefused(
				"Only a run a restart interrupted can be resumed this way.",
			);
		const { inv, original, turn } = found;
		const plan = await this.planFollowUp(inv, {});
		if (!plan) throw new FollowUpRefused("Pick an agent to continue in.");
		if (!(await containPrevious(readReceipt(runDirFor(id))).catch(() => false)))
			throw new FollowUpRefused(
				`${agentLabel(plan.harness)} from before the restart may still be running. Resume once it has stopped.`,
			);
		if (plan.preflight)
			throw new FollowUpRefused(
				`${plan.preflight.problem} ${plan.preflight.fix}`,
			);
		const now = new Date();
		const last = await this.lastActivity(id, now);
		const data = recoveryPayload(
			original,
			plan,
			turn,
			{
				attempt: 1,
				stoppedAt: last.toISOString(),
				lastActivityAt: last.toISOString(),
				by: "operator",
			},
			await this.hasToolResult(id),
		);
		if (!(await this.rearm(id, inv.incidentId, turn, data, now, "interrupted")))
			throw new FollowUpRefused("The run changed; reload it.");
		this.streamRelay.attach(id);
		void this.dispatcher.tick();
	}

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
		// The conversation line is best-effort; the standing is written first (#804 OBJ-031).
		try {
			const seq =
				(await this.investigationsService.lastEventSeq(investigationId)) + 1;
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
