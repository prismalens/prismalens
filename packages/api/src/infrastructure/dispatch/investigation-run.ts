// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One investigation job: detect the harness, snapshot the incident's repo into the
 * run dir, run one ACP session there, persist the stream and the report
 * (ADR 0002, 0003, 0005). No model call; no user checkout as cwd.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getAppDataDir } from "@prismalens/config";
import {
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	getHarnessProviderKeys,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	type ModelSource,
	resolveAccess,
	resolveHarnessModel,
} from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import {
	type CanonicalEvent,
	correlatedAlertsContext,
	type FiringAlert,
	type IncidentContext,
	type InvestigationContext,
	type InvestigationJobData,
	InvestigationJobDataSchema,
	type InvestigationReport,
	isWorkflowLive,
	type RunWorkspace,
	type RunWorkspaceRepo,
	RunWorkspaceSchema,
	ServiceInvestigationMetadataSchema,
	type TurnOutcome,
	toFiringAlert,
	type WorkflowStatus,
} from "@prismalens/contracts";
import type {
	ContextPack,
	EffortEstimate,
	RecommendationCategory,
	RecommendationPriority,
	Urgency,
} from "@prismalens/contracts/schemas";
import {
	conductRun,
	type InvestigationSink,
	type PermissionPolicy,
	type ResolvedConnector,
	type SteerPort,
	telemetryEndpointsFrom,
} from "@prismalens/engine";
import { enrichContext, Logger } from "@prismalens/logger";
import { runWithWideEvent } from "@prismalens/logger/standalone";
import { displayNameFor } from "../../core/harness/repo-source.service.js";
import { createPrismaInvestigationStore } from "./prisma-investigation-store.js";
import type { IncidentRepo, RunPorts } from "./run-ports.js";

const logger = new Logger({ context: "InvestigationProcessor" });

export interface InvestigationResult {
	success: boolean;
	investigationId: string;
	incidentId: string;
	findings: { rootCause?: string; summary?: string };
	recommendations: Array<{
		title: string;
		description?: string;
		priority?: RecommendationPriority;
		category?: RecommendationCategory;
		urgency?: Urgency;
		actionable?: boolean;
		estimatedEffort?: EffortEstimate;
	}>;
	error?: string;
	errorType?: string;
}

export interface JobIo {
	emit(event: CanonicalEvent): void | Promise<void>;
	streamDone(): void | Promise<void>;
	signal: AbortSignal;
	steer?: SteerPort;
	/** Answers the agent's asks; the operator's Approve or Deny (#673 w21). */
	permission?: PermissionPolicy;
}

export interface JobContext {
	id: string;
	investigationId: string;
	attempts: number;
}

export default async function runInvestigationJob(
	job: JobContext,
	rawData: InvestigationJobData,
	io: JobIo,
	ports: RunPorts,
): Promise<InvestigationResult> {
	const unvalidated = rawData as Partial<InvestigationJobData> | undefined;
	return runWithWideEvent(
		`job-${job.id}`,
		async () => runJobInternal(job, rawData, io, ports),
		{
			context: {
				job_id: job.id,
				investigation_id: unvalidated?.investigationId,
				incident_id: unvalidated?.incidentId,
			},
		},
	);
}

async function runJobInternal(
	job: JobContext,
	rawPayload: InvestigationJobData,
	io: JobIo,
	ports: RunPorts,
): Promise<InvestigationResult> {
	const unvalidated = rawPayload as Partial<InvestigationJobData> | undefined;
	if (unvalidated?.resume) return runFollowUp(rawPayload, io, ports);
	try {
		const data = InvestigationJobDataSchema.parse(rawPayload);
		logger.info(
			`Processing job ${job.id} for investigation ${data.investigationId}`,
		);
		enrichContext({
			context: {
				alert_count: data.alerts?.length ?? 0,
				priority: data.priority,
			},
		});

		try {
			const current = await ports.findInvestigation(data.investigationId);
			if (current?.status === "cancelled") {
				logger.info(
					`Job ${job.id} skipped — investigation ${data.investigationId} already cancelled`,
				);
				return cancelledResult(data);
			}
		} catch (e) {
			logger.warn(
				"Could not check investigation status before run — cancellation will not be honoured",
				e,
			);
		}
		if (job.attempts > 1) {
			try {
				await ports.clearEvents(data.investigationId);
			} catch (e) {
				logger.error("Failed to clear stale durable events on retry", e);
			}
		}

		const resolved = await ports.resolveHarness({
			...(data.harness ? { harness: data.harness } : {}),
			...(data.model !== undefined ? { model: data.model } : {}),
			...(data.effort !== undefined ? { effort: data.effort } : {}),
		});
		const { selection, model, modelSource, effort, customModel } = resolved;
		if (!selection.runnable) throw new Error(selection.reason);
		// The run's own chip, else Settings and the agent's default as resolved (#673 w21).
		const accessLevel =
			data.accessLevel ?? resolved.accessLevel ?? DEFAULT_ACCESS_LEVEL;
		const agentMode =
			resolveAccess(selection.harness, accessLevel).mode ?? null;
		logger.info(
			`harness: ${selection.harness} (${selection.auto ? "auto" : `pinned by ${selection.pinnedBy ?? "env"}`}), model: ${model ?? "harness default"} (${modelSource ?? "unknown"})`,
		);

		let incident: Record<string, unknown> | null = null;
		try {
			incident = await ports.getIncident(data.incidentId);
		} catch {
			incident = null;
		}
		let connectors: ResolvedConnector[] = [];
		try {
			const serviceId =
				typeof incident?.serviceId === "string"
					? incident.serviceId
					: undefined;
			connectors = await ports.resolveConnectors(serviceId);
		} catch (e) {
			logger.warn("Could not resolve connectors for investigation", e);
			connectors = [];
		}
		let contextPack: ContextPack | null = null;
		try {
			contextPack = await ports.contextPack(data.incidentId);
		} catch (e) {
			logger.warn("Could not assemble the context pack for investigation", e);
			contextPack = null;
		}
		const context = await assembleInvestigationContext(
			incident,
			data,
			connectors,
			contextPack,
		);
		const workspace = await resolveWorkspace(data, ports, io.signal);
		await recordWorkspace(data, workspace, ports, context);
		const multi = workspaceContext(workspace);
		if (multi) context.workspace = multi;

		const runId = data.investigationId;
		const runDir = runDirFor(runId);
		mkdirSync(runDir, { recursive: true });
		const sink: InvestigationSink = async (event) => {
			await io.emit(event);
		};
		const store = createPrismaInvestigationStore(ports, {
			investigationId: data.investigationId,
			incidentId: data.incidentId,
			runId,
			harness: selection.harness,
			...(model ? { model } : {}),
			...(effort ? { effort } : {}),
			workspace: JSON.stringify(toRunWorkspace(workspace)),
			...(agentMode ? { agentMode } : {}),
			accessLevel,
			...(data.chat ? { chat: true } : {}),
		});
		const harness = selection.harness;
		const kind: ThreadKind = data.chat ? "chat" : "investigation";
		// A chat run's message is its whole first turn, with its own files (#673).
		const brief = data.chat?.text ?? data.brief;
		const attachments = data.chat ? data.chat.attachments : data.attachments;
		const outcome = await conductRun(
			{
				runId,
				context,
				harness: selection.harness,
				cwd: workspace.cwd,
				runDir,
				...(model ? { model } : {}),
				...(modelSource ? { modelSource } : {}),
				...(customModel ? { customModel } : {}),
				...(effort ? { effort } : {}),
				accessLevel,
				...(attachments?.length ? { attachments } : {}),
				...(data.chat ? { kind: "chat" as const } : {}),
				// Never process.env: the child gets only the launcher's allowlist (layered on by buildChildEnv) plus this harness's own provider keys, never prismalens's own PRISMALENS_* secrets (ADR 0004 §5).
				env: getHarnessProviderKeys(selection.harness, process.env),
				limits: { wallClockMs: INVESTIGATION_DEFAULTS.harnessWallClockMs },
				initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
				promptTimeoutMs: INVESTIGATION_DEFAULTS.harnessWallClockMs,
				onHarnessStderr: (chunk) => {
					const line = chunk.trimEnd();
					if (line) logger.debug(`harness stderr: ${line}`);
				},
				onPolicyWarning: (message) => logger.warn(message),
				onHarnessDrift: (message) => logger.warn(message),
				signal: io.signal,
				...(io.steer ? { steer: io.steer } : {}),
				...(io.permission ? { permission: io.permission } : {}),
				...(brief ? { brief } : {}),
				onSession: (s) => keepSession(ports, runId, harness, s),
			},
			{ sink, store },
		);
		await io.streamDone();

		if (outcome.failureKind === "cancelled") {
			logger.info(`Job ${job.id} cancelled`);
			try {
				await persistCancelled(data, ports, kind);
			} catch (e) {
				logger.error("Failed to persist cancelled status", e);
			}
			return cancelledResult(data);
		}
		const owned = store.refused()
			? await ownTheEnd(data, ports, {
					stop: () => persistCancelled(data, ports, kind),
					reject: (why) => persistRejected(data, ports, kind, why),
				})
			: null;
		if (owned) return owned;
		if (data.chat && !outcome.error) {
			logger.info(`Job ${job.id} chat ended`);
			return chatResult(data);
		}
		if (!outcome.report) {
			return failureResult(
				data,
				outcome.error ?? "investigation produced no evidence",
			);
		}
		logger.info(`Job ${job.id} completed`);
		return successResult(data, outcome.report);
	} catch (error: unknown) {
		// A cancel that lands before the harness starts (during the clone) is still a cancel (#605 edge 23).
		const parsed = InvestigationJobDataSchema.safeParse(rawPayload);
		if (io.signal.aborted && parsed.success) {
			logger.info(`Job ${job.id} cancelled before the harness started`);
			try {
				await persistCancelled(
					parsed.data,
					ports,
					parsed.data.chat ? "chat" : "investigation",
				);
			} catch (e) {
				logger.error("Failed to persist cancelled status", e);
			}
			return cancelledResult(parsed.data);
		}
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Job failed: ${errorMessage}`, error);
		const investigationId = unvalidated?.investigationId;
		const incidentId = unvalidated?.incidentId;
		if (investigationId) {
			try {
				const applied = await ports.updateStatus(investigationId, {
					status: "failed",
					error: errorMessage,
				});
				// Stop was asked for: the run can only end cancelled (#673 w59).
				if (!applied && parsed.success) {
					const owned = await ownTheEnd(parsed.data, ports, {
						stop: () =>
							persistCancelled(
								parsed.data,
								ports,
								parsed.data.chat ? "chat" : "investigation",
							),
						reject: async () => {},
					});
					if (owned?.errorType === "cancelled") return owned;
				}
				if (applied && incidentId) {
					await ports.createTimelineEntry({
						incidentId,
						type: "investigation_completed",
						title: unvalidated?.chat ? "Chat error" : "Investigation failed",
						description: errorMessage,
						source: "ai_worker",
						metadata: { investigationId, error: errorMessage },
					});
				}
			} catch (e) {
				logger.error("Failed to update failure status", e);
			}
		}
		throw error;
	} finally {
		// A full clone per run fills the disk; the workspace note keeps source and HEAD, the transcript stays (#637 N3).
		// The harness's per-run home and the packages it installs under its config dir go too:
		// 125 MB per OpenCode run in #337 run e (G18). The config files themselves stay.
		if (unvalidated?.investigationId) {
			clearRunWorkspace(runDirFor(unvalidated.investigationId));
		}
	}
}

/** Only a session the harness can load again is worth keeping (#747). */
function keepSession(
	ports: RunPorts,
	id: string,
	harness: HarnessId,
	s: { sessionId: string; loadSession: boolean },
): void {
	if (!s.loadSession || !HARNESS_REGISTRY[harness].resume) return;
	ports
		.recordSession(id, s.sessionId)
		.catch((e) => logger.warn("Failed to keep the harness session id", e));
}

/**
 * A message on a finished run: the same harness session loaded again in the
 * first run's workspace, rebuilt at the same path and commits (#747). An Ask
 * never touches the report, the incident or deliveries; how it ends is
 * settled by {@link followUpEnd}. A `continue` on a reportless investigation
 * is the run again (R4.4): its store writes the end as a run's would.
 */
async function runFollowUp(
	rawPayload: InvestigationJobData,
	io: JobIo,
	ports: RunPorts,
): Promise<InvestigationResult> {
	const data = InvestigationJobDataSchema.parse(rawPayload);
	const resume = data.resume as NonNullable<InvestigationJobData["resume"]>;
	const continuing = resume.kind === "continue";
	const id = data.investigationId;
	const runDir = runDirFor(id);
	let kind: ThreadKind = "investigation";
	let report: InvestigationReport | null = null;
	let storeRefused: () => boolean = () => false;
	// The prompt reached the agent; before that every end puts the standing back (X1, #804 OBJ-026).
	let delivered: () => boolean = () => false;
	let end: { outcome: TurnOutcome; sentence: string | null };
	let threw = false;
	let seqStart = 0;
	try {
		seqStart = (await ports.lastEventSeq(id)) + 1;
		const inv = await ports.findInvestigation(id);
		if (inv?.kind === "chat") kind = "chat";
		const harness = HARNESS_IDS.find((h) => h === inv?.harness);
		const blocked = !inv
			? "the investigation is gone"
			: !harness || !inv.acpSessionId
				? "its agent kept no session to reopen"
				: !inv.workspace
					? "it recorded no workspace"
					: null;
		if (blocked || !inv?.acpSessionId || !inv.workspace || !harness)
			throw new Error(`This run cannot be continued: ${blocked}.`);
		const row = HARNESS_REGISTRY[harness];
		if (!row.resume)
			throw new Error(
				`${row.label} can't reopen a finished session, so a new run starts from the report.`,
			);
		if (!resolveOnPath(row.binary))
			throw new Error(`${row.label} is no longer installed.`);
		const recorded = RunWorkspaceSchema.parse(JSON.parse(inv.workspace));
		// ADR 0004 §2 keeps the pinned commit; the agent is told when a newer run saw others (#673 w27).
		const newer = await ports.newerRun(id).catch(() => null);
		const moved = newer?.heads.some(
			(h) => recorded.repos.find((r) => r.name === h.name)?.head !== h.head,
		)
			? newer
			: null;
		const workspace = await rebuildWorkspace(
			recorded,
			id,
			row.label,
			ports,
			io.signal,
		);

		let incident: Record<string, unknown> | null = null;
		try {
			incident = await ports.getIncident(data.incidentId);
		} catch {
			incident = null;
		}
		let connectors: ResolvedConnector[] = [];
		try {
			const serviceId =
				typeof incident?.serviceId === "string"
					? incident.serviceId
					: undefined;
			connectors = await ports.resolveConnectors(serviceId);
		} catch (e) {
			logger.warn("Could not resolve connectors for the follow-up", e);
		}
		const context = await assembleInvestigationContext(
			incident,
			data,
			connectors,
		);
		const multi = workspaceContext(workspace);
		if (multi) context.workspace = multi;

		mkdirSync(runDir, { recursive: true });
		const base = createPrismaInvestigationStore(ports, {
			investigationId: id,
			incidentId: data.incidentId,
			runId: id,
			workspace: JSON.stringify(toRunWorkspace(workspace)),
			resume: { note: workspace.note, continuing },
			...(kind === "chat" ? { chat: true } : {}),
		});
		storeRefused = base.refused;
		delivered = base.delivered;
		const store = base;
		const modelSource = followUpModelSource(harness, inv.model);
		// A reloaded session takes an added model the same way the run did (#673 w57).
		const customModel =
			modelSource === "operator" &&
			!!(await ports
				.resolveHarness({ harness, model: inv.model })
				.then((r) => r.customModel)
				.catch(() => false));
		const outcome = await conductRun(
			{
				runId: id,
				context,
				harness,
				cwd: workspace.cwd,
				runDir,
				...(inv.model ? { model: inv.model } : {}),
				...(modelSource ? { modelSource } : {}),
				...(customModel ? { customModel } : {}),
				...(inv.effort ? { effort: inv.effort } : {}),
				...(data.accessLevel ? { accessLevel: data.accessLevel } : {}),
				env: getHarnessProviderKeys(harness, process.env),
				limits: { wallClockMs: INVESTIGATION_DEFAULTS.harnessWallClockMs },
				initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
				promptTimeoutMs: INVESTIGATION_DEFAULTS.harnessWallClockMs,
				onHarnessStderr: (chunk) => {
					const line = chunk.trimEnd();
					if (line) logger.debug(`harness stderr: ${line}`);
				},
				onPolicyWarning: (message) => logger.warn(message),
				onHarnessDrift: (message) => logger.warn(message),
				signal: io.signal,
				...(io.steer ? { steer: io.steer } : {}),
				...(io.permission ? { permission: io.permission } : {}),
				resume: {
					sessionId: inv.acpSessionId,
					text: resume.text,
					mode: resume.mode,
					heads: workspace.repos.map((r) => ({ name: r.name, head: r.head })),
					...(continuing
						? { kind: "continue" as const, sawEvidence: !!resume.sawEvidence }
						: {}),
					...(resume.attachments?.length
						? { attachments: resume.attachments }
						: {}),
					...(moved ? { newer: moved } : {}),
				},
				seqStart,
			},
			{
				sink: async (event) => {
					await io.emit(event);
				},
				store,
			},
		);
		await io.streamDone();
		report = outcome.report;
		end =
			outcome.failureKind === "cancelled"
				? { outcome: "stopped", sentence: null }
				: outcome.error
					? { outcome: "error", sentence: outcome.error }
					: { outcome: "answered", sentence: null };
	} catch (error: unknown) {
		threw = true;
		const message = io.signal.aborted
			? "investigation cancelled"
			: error instanceof Error
				? error.message
				: String(error);
		logger.error(`Follow-up failed: ${message}`, error);
		await sayInConversation(id, seqStart, resume, message, io, ports);
		end = {
			outcome: io.signal.aborted ? "stopped" : "error",
			sentence: message,
		};
	} finally {
		clearRunWorkspace(runDir);
	}

	// A `continue` that reached its agent ends as a run (I6-I8); everything else is settled here.
	const ran = delivered();
	const runEnds = continuing && ran;
	const settle = async (
		outcome: TurnOutcome,
		sentence: string | null,
	): Promise<boolean> => {
		const to = followUpEnd(
			ran ? kind : null,
			resume.restore,
			outcome,
			sentence,
		);
		// A write that threw is not applied (#804 OBJ-024): one retry, then the run owns the end.
		let applied = false;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				applied = await ports.settleFollowUp(id, to.row, {
					stopped: outcome === "stopped",
				});
				break;
			} catch (e) {
				logger.error("Failed to settle the follow-up", e);
			}
		}
		if (applied && to.timeline)
			await ports
				.createTimelineEntry({
					incidentId: data.incidentId,
					type: "investigation_completed",
					...to.timeline,
					source: "ai_worker",
					metadata: { investigationId: id },
				})
				.catch((e) => logger.warn("Failed to record the follow-up's end", e));
		return applied;
	};
	let refused: boolean;
	if (!runEnds) refused = !(await settle(end.outcome, end.sentence));
	else if (end.outcome === "stopped")
		refused = !(await persistCancelled(data, ports, kind, "stopped").catch(
			(e) => {
				logger.error("Failed to persist cancelled status", e);
				return false;
			},
		));
	// A throw may skip the store's terminal write; ownTheEnd leaves a row already ended alone.
	else refused = threw || storeRefused();
	const owned = refused
		? await ownTheEnd(data, ports, {
				stop: () =>
					runEnds
						? persistCancelled(data, ports, kind, "stopped")
						: settle("stopped", null),
				reject: (why) =>
					runEnds
						? persistRejected(data, ports, kind, why, "error")
						: settle("error", why),
			})
		: null;
	if (owned) return owned;
	if (end.outcome === "stopped") return cancelledResult(data);
	if (end.outcome === "error")
		return failureResult(data, end.sentence ?? "the follow-up failed");
	if (report) return successResult(data, report);
	return chatResult(data);
}

export type ThreadKind = "investigation" | "chat";

/**
 * How a follow-up that is not a `continue` ends the row: the settlement
 * table, DESIGN §3.3 (#673 w59). An investigation keeps its standing (I1-I5);
 * a chat's standing is its latest outcome (C1-C3); a follow-up whose agent
 * never ran (`kind` null) puts the standing back (X1).
 */
export function followUpEnd(
	kind: ThreadKind | null,
	restore: NonNullable<InvestigationJobData["resume"]>["restore"],
	outcome: TurnOutcome,
	sentence: string | null,
	now: Date = new Date(),
): {
	row: {
		status: WorkflowStatus;
		completedAt: Date | null;
		error: string | null;
		lastTurnOutcome: TurnOutcome;
	};
	timeline: { title: string; description: string } | null;
} {
	const kept = {
		status: restore.status,
		completedAt: restore.completedAt ? new Date(restore.completedAt) : null,
		error: restore.error,
		lastTurnOutcome: outcome,
	};
	if (kind === null) return { row: kept, timeline: null };
	const said = sentence ?? "The agent stopped without saying why.";
	if (kind === "investigation") {
		if (outcome === "answered") return { row: kept, timeline: null };
		return {
			row: kept,
			timeline:
				outcome === "stopped"
					? {
							title: "Investigation stopped",
							description: "You stopped the follow-up; the run is unchanged.",
						}
					: { title: "Investigation error", description: said },
		};
	}
	if (outcome === "answered")
		return {
			row: {
				status: "completed",
				completedAt: now,
				error: null,
				lastTurnOutcome: outcome,
			},
			timeline: {
				title: "Chat ended",
				description: "The agent answered; the conversation holds it.",
			},
		};
	if (outcome === "stopped")
		return {
			row: {
				status: "cancelled",
				completedAt: now,
				error: "Chat stopped",
				lastTurnOutcome: outcome,
			},
			timeline: {
				title: "Chat stopped",
				description: "You stopped the agent before it answered.",
			},
		};
	return {
		row: {
			status: "failed",
			completedAt: now,
			error: said,
			lastTurnOutcome: outcome,
		},
		timeline: { title: "Chat error", description: said },
	};
}

/**
 * The run owns its row's end (#673 w59, OBJ-010). Once its terminal write is
 * done the run reads the row again; one still live had that write refused,
 * and is ended here: cancelled when Stop was asked for, else failed.
 */
async function ownTheEnd(
	data: InvestigationJobData,
	ports: RunPorts,
	end: {
		stop: () => Promise<unknown>;
		reject: (why: string) => Promise<unknown>;
	},
): Promise<InvestigationResult | null> {
	let row: Awaited<ReturnType<RunPorts["findInvestigation"]>>;
	try {
		row = await ports.findInvestigation(data.investigationId);
	} catch (e) {
		// Unconfirmed is not success: boot reconciliation settles the row (#804 OBJ-024).
		logger.warn("Could not read the run's row back after its end", e);
		return failureResult(data, "the run's end could not be saved");
	}
	if (!row || !isWorkflowLive(row.status)) return null;
	if (row.stopRequestedAt) {
		await end
			.stop()
			.catch((e) => logger.error("Failed to end the run as stopped", e));
		return cancelledResult(data);
	}
	const why = "terminal write rejected: the row did not take the run's end";
	await end.reject(why).catch((e) => logger.error("Failed to end the run", e));
	return failureResult(data, why);
}

/**
 * The row keeps the model, not where it came from: the env or the product default
 * when they still name it, else the operator's pick, which the agent must take (R4.2).
 */
export function followUpModelSource(
	harness: HarnessId,
	model: string | null,
): ModelSource | undefined {
	if (!model) return undefined;
	const now = resolveHarnessModel(harness, undefined, process.env);
	return now.model === model ? now.source : "operator";
}

/** The follow-up's message, not delivered, and why: what the conversation shows when it never ran. */
export function followUpNotDelivered(
	runId: string,
	seq: number,
	resume: NonNullable<InvestigationJobData["resume"]>,
	message: string,
): CanonicalEvent[] {
	const base = {
		runId,
		branchId: "run",
		path: [],
		ts: new Date().toISOString(),
	};
	return [
		{
			kind: "operator_message",
			...base,
			seq,
			text: resume.text,
			mode: resume.mode,
			delivered: false,
		},
		{ kind: "error", ...base, seq: seq + 1, message },
	];
}

/** A follow-up that never reached the harness still answers in the conversation. */
async function sayInConversation(
	runId: string,
	seq: number,
	resume: NonNullable<InvestigationJobData["resume"]>,
	message: string,
	io: JobIo,
	ports: RunPorts,
): Promise<void> {
	const events = followUpNotDelivered(runId, seq, resume, message);
	try {
		for (const event of events) await io.emit(event);
		await ports.appendEvents(runId, events);
	} catch (e) {
		logger.warn("Could not record the failed follow-up in the conversation", e);
	}
}

const RUN_WORKSPACE = [
	"repo",
	"repos",
	"unmapped",
	"home",
	join("config", "node_modules"),
];

function clearRunWorkspace(runDir: string): void {
	for (const rel of RUN_WORKSPACE) {
		try {
			rmSync(join(runDir, rel), { recursive: true, force: true });
		} catch (e) {
			logger.warn(`Failed to remove the run's ${rel}`, e);
		}
	}
}

/**
 * Called at boot, when nothing is running: a process that died mid-run never
 * reached the run's `finally`, so its clone and harness home are still on disk.
 */
export function sweepRunWorkspaces(): number {
	const runs = resolve(getAppDataDir(), "runs");
	if (!existsSync(runs)) return 0;
	let swept = 0;
	for (const entry of readdirSync(runs, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(runs, entry.name);
		if (RUN_WORKSPACE.some((rel) => existsSync(join(dir, rel)))) {
			clearRunWorkspace(dir);
			swept++;
		}
	}
	return swept;
}

/** `runs/<id>` for a job id, refusing an id that would resolve anywhere else (it is joined, then deleted from). */
export function runDirFor(investigationId: string): string {
	const runs = resolve(getAppDataDir(), "runs");
	const dir = resolve(runs, investigationId);
	if (!/^[A-Za-z0-9_-]+$/.test(investigationId) || dirname(dir) !== runs)
		throw new Error(
			`Invalid investigation id for a run directory: ${investigationId}`,
		);
	return dir;
}

export interface Workspace extends RunWorkspace {
	note: string;
}

function toRunWorkspace({ note: _note, ...ws }: Workspace): RunWorkspace {
	return ws;
}

/** The prompt lists each repo only when there are several (#747). */
function workspaceContext(
	ws: RunWorkspace,
): InvestigationContext["workspace"] | undefined {
	if (ws.layout !== "multi") return undefined;
	return {
		repos: ws.repos.map((r) => ({
			path: `${r.name}/`,
			services: r.services,
			subPath: r.subPath,
			head: r.head,
		})),
	};
}

/** One entry per `(sourceKind, url)`, with every service that links it; the first sub-path wins. */
function dedupeRepos(repos: IncidentRepo[]): {
	repo: IncidentRepo;
	services: string[];
}[] {
	const byKey = new Map<string, { repo: IncidentRepo; services: string[] }>();
	for (const repo of repos) {
		const key = `${repo.sourceKind}\0${repo.url}`;
		const seen = byKey.get(key);
		if (!seen) byKey.set(key, { repo, services: [repo.serviceName] });
		else if (!seen.services.includes(repo.serviceName))
			seen.services.push(repo.serviceName);
	}
	return [...byKey.values()];
}

/** The folder a repo gets under `repos/`: the last segment of its display name, unique. */
function folderNames(repos: IncidentRepo[]): string[] {
	const used = new Set<string>();
	return repos.map((repo) => {
		const base =
			(displayNameFor(repo.sourceKind, repo.url).split("/").pop() ?? "")
				.replace(/[^A-Za-z0-9._-]/g, "_")
				.replace(/^\.+$/, "_") || "repo";
		let name = base;
		for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
		used.add(name);
		return name;
	});
}

/** `sub` resolved inside `root`, refusing a path that climbs out. */
function inside(root: string, sub: string | null): string {
	const dir = sub ? resolve(root, sub) : root;
	const rel = relative(root, dir);
	// Across Windows drives `relative` stays absolute, so `..` alone is not the test.
	if (rel.startsWith("..") || isAbsolute(rel) || resolve(root, rel) !== dir)
		throw new Error(`Repository sub-path escapes the snapshot: ${sub}`);
	return dir;
}

function whereFrom(repo: {
	sourceKind: string;
	url: string;
	subPath: string | null;
}): string {
	const from = repo.sourceKind === "folder" ? "folder" : "URL";
	return `${from} ${repo.url}${repo.subPath ? `/${repo.subPath}` : ""}`;
}

/**
 * The harness runs in fresh snapshots of every repo the incident touches, under
 * the run's own dir (ADR 0004 §2). One repo keeps `repo/`; several go under
 * `repos/<name>/` with the cwd at `repos/` (#747). No linked repo means an
 * UNMAPPED run in an empty scratch dir that says so; a run against the wrong
 * tree produces confident garbage.
 */
export async function resolveWorkspace(
	data: InvestigationJobData,
	ports: RunPorts,
	signal?: AbortSignal,
): Promise<Workspace> {
	let listed: IncidentRepo[] = [];
	try {
		listed = await ports.incidentRepos(data.incidentId);
	} catch (e) {
		logger.warn("Could not list the incident's repos", e);
	}
	const runDir = runDirFor(data.investigationId);
	const repos = dedupeRepos(listed);
	if (repos.length === 0) {
		const cwd = join(runDir, "unmapped");
		mkdirSync(cwd, { recursive: true });
		return {
			layout: "unmapped",
			cwd,
			repos: [],
			note: "Ran UNMAPPED: this incident's service has no repository linked. Set the Repository field on the service to a folder path or git URL; findings below cannot describe the code that alerted.",
		};
	}
	const multi = repos.length > 1;
	const names = multi ? folderNames(repos.map((r) => r.repo)) : ["repo"];
	const taken: RunWorkspaceRepo[] = [];
	const skipped: string[] = [];
	// One at a time: every clone lands on the same disk.
	for (const [i, { repo, services }] of repos.entries()) {
		const name = names[i] as string;
		try {
			const { snap, credential } = await ports.snapshotWith(
				{
					sourceKind: repo.sourceKind,
					url: repo.url,
					connectionId: repo.connectionId,
					defaultBranch: repo.defaultBranch,
				},
				multi ? join(runDir, "repos", name) : join(runDir, "repo"),
				signal,
			);
			inside(snap.path, repo.subPath);
			taken.push({
				name,
				dir: snap.path,
				sourceKind: repo.sourceKind,
				url: repo.url,
				subPath: repo.subPath,
				connectionId: repo.connectionId,
				head: snap.head,
				branch: snap.branch,
				services,
				credential,
			});
		} catch (e) {
			// The primary service's repo is the run; another alert's broken link is not.
			if (i === 0 || signal?.aborted) throw e;
			const why = e instanceof Error ? e.message : String(e);
			logger.warn(`Skipped ${whereFrom(repo)}: ${why}`);
			skipped.push(`${whereFrom(repo)} (${why})`);
		}
	}
	const omitted = skipped.length
		? ` Not included, because it could not be copied: ${skipped.join("; ")}.`
		: "";
	if (taken.length === 1) {
		const [only] = taken as [RunWorkspaceRepo];
		return {
			layout: "single",
			cwd: inside(only.dir, only.subPath),
			repos: taken,
			note: `Investigating a snapshot of ${whereFrom(only)} at ${only.branch ? `${only.branch} ` : ""}${only.head.slice(0, 12)}. Uncommitted changes are not included.${omitted}`,
		};
	}
	const listing = taken
		.map(
			(r) =>
				`${r.name} (${whereFrom(r)}) at ${r.branch ? `${r.branch} ` : ""}${r.head.slice(0, 7)}`,
		)
		.join(", ");
	return {
		layout: "multi",
		cwd: join(runDir, "repos"),
		repos: taken,
		note: `Investigating snapshots of ${taken.length} repositories: ${listing}. Uncommitted changes are not included.${omitted}`,
	};
}

/**
 * The first run's workspace again, at the same paths and commits: harness
 * session stores are keyed by directory (anthropics/claude-code#58591, #747).
 * Each repo carries the credential this rebuild used, which may differ from the first run's (#673).
 */
export async function rebuildWorkspace(
	ws: RunWorkspace,
	investigationId: string,
	harnessLabel: string,
	ports: RunPorts,
	signal?: AbortSignal,
): Promise<Workspace> {
	const runDir = runDirFor(investigationId);
	// Paths come back from the row; nothing outside this run's dir is ever replaced.
	inside(runDir, relative(runDir, ws.cwd));
	const repos: RunWorkspaceRepo[] = [];
	for (const repo of ws.repos) {
		inside(runDir, relative(runDir, repo.dir));
		if (!/^[0-9a-f]{7,64}$/i.test(repo.head))
			throw new Error(`Recorded commit is not a commit id: ${repo.head}`);
		const { credential } = await ports.snapshotWith(
			{
				sourceKind: repo.sourceKind,
				url: repo.url,
				connectionId: repo.connectionId,
			},
			repo.dir,
			signal,
			repo.head,
		);
		repos.push({ ...repo, credential });
	}
	mkdirSync(ws.cwd, { recursive: true });
	const pinned =
		ws.repos.length === 1
			? (ws.repos[0] as RunWorkspaceRepo).head.slice(0, 7)
			: ws.repos.map((r) => `${r.name}@${r.head.slice(0, 7)}`).join(", ");
	return {
		...ws,
		repos,
		note: ws.repos.length
			? `Continuing the same ${harnessLabel} session in a fresh workspace pinned to ${pinned}.`
			: `Continuing the same ${harnessLabel} session; this run had no repository.`,
	};
}

async function recordWorkspace(
	data: InvestigationJobData,
	ws: Workspace,
	ports: RunPorts,
	context?: InvestigationContext,
): Promise<void> {
	const only = ws.repos[0];
	try {
		const promHost = context?.telemetry?.prometheusUrl
			? (() => {
					try {
						return new URL(context.telemetry.prometheusUrl).hostname;
					} catch {
						return undefined;
					}
				})()
			: undefined;
		const amHost = context?.telemetry?.alertmanagerUrl
			? (() => {
					try {
						return new URL(context.telemetry.alertmanagerUrl).hostname;
					} catch {
						return undefined;
					}
				})()
			: undefined;
		const telemetry =
			promHost || amHost
				? {
						...(promHost ? { prometheus: promHost } : {}),
						...(amHost ? { alertmanager: amHost } : {}),
					}
				: undefined;

		await ports.createTimelineEntry({
			incidentId: data.incidentId,
			type: "investigation_started",
			title:
				ws.layout === "multi"
					? "Investigating the service's repositories"
					: ws.layout === "single"
						? "Investigating the service's repository"
						: "No repository linked: the agent read no code",
			description: ws.note,
			source: "ai_worker",
			metadata: {
				investigationId: data.investigationId,
				cwd: ws.cwd,
				mapped: ws.layout !== "unmapped",
				...(ws.layout === "single" && only
					? { repo: only.url, head: only.head }
					: {}),
				repos: ws.repos.map((r) => ({
					name: r.name,
					url: r.url,
					head: r.head,
				})),
				...(telemetry ? { telemetry } : {}),
			},
		});
	} catch (e) {
		logger.error("Failed to record the investigation workspace", e);
	}
}

/** A stop ends the row cancelled, in the thread's own words (#673 w59). */
async function persistCancelled(
	data: InvestigationJobData,
	ports: RunPorts,
	kind: ThreadKind,
	lastTurnOutcome?: TurnOutcome,
): Promise<boolean> {
	const chat = kind === "chat";
	const applied = await ports.updateStatus(data.investigationId, {
		status: "cancelled",
		error: chat ? "Chat stopped" : "Investigation cancelled",
		...(lastTurnOutcome ? { lastTurnOutcome } : {}),
	});
	if (!applied) return false;
	await ports.createTimelineEntry({
		incidentId: data.incidentId,
		type: "investigation_completed",
		title: chat ? "Chat stopped" : "Investigation stopped",
		description: chat
			? "You stopped the agent before it answered."
			: "The investigation was cancelled before it completed.",
		source: "ai_worker",
		metadata: { investigationId: data.investigationId },
	});
	return true;
}

/** A run whose end the row refused, with no Stop asked for, ends failed (#673 w59). */
async function persistRejected(
	data: InvestigationJobData,
	ports: RunPorts,
	kind: ThreadKind,
	why: string,
	lastTurnOutcome?: TurnOutcome,
): Promise<void> {
	const applied = await ports.updateStatus(data.investigationId, {
		status: "failed",
		error: why,
		...(lastTurnOutcome ? { lastTurnOutcome } : {}),
	});
	if (!applied) return;
	await ports.createTimelineEntry({
		incidentId: data.incidentId,
		type: "investigation_completed",
		title: kind === "chat" ? "Chat error" : "Investigation failed",
		description: why,
		source: "ai_worker",
		metadata: { investigationId: data.investigationId, error: why },
	});
}

async function assembleInvestigationContext(
	incident: Record<string, unknown> | null,
	data: InvestigationJobData,
	connectors: ResolvedConnector[] = [],
	contextPack: ContextPack | null = null,
): Promise<InvestigationContext> {
	const rawAlerts = (
		data.alerts && data.alerts.length > 0
			? data.alerts
			: Array.isArray(incident?.alerts) && incident.alerts.length > 0
				? incident.alerts
				: null
	) as Record<string, unknown>[] | null;
	const firingAlerts: FiringAlert[] = rawAlerts
		? rawAlerts.map((a) => toFiringAlert(a as Record<string, unknown>))
		: [incidentAsAlert(incident)];
	const service = incident?.service as
		| { name?: string; tier?: string; metadata?: unknown }
		| null
		| undefined;
	const notes = serviceNotes(service?.metadata);
	const telemetry = telemetryEndpointsFrom(connectors, (m) => logger.warn(m));
	return correlatedAlertsContext(firingAlerts, telemetry, {
		incident: incident ? incidentMeta(incident) : undefined,
		...(service?.name
			? {
					service: {
						name: service.name,
						...(service.tier ? { tier: service.tier } : {}),
						...(notes ? { notes } : {}),
					},
				}
			: {}),
		...(contextPack ? { contextPack } : {}),
	});
}

/** The service's `metadata.investigation.notes`, stored as JSON text or an object; null when absent or empty. */
function serviceNotes(metadata: unknown): string | null {
	let value: unknown = metadata;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	const parsed = ServiceInvestigationMetadataSchema.safeParse(
		(value as { investigation?: unknown } | null)?.investigation,
	);
	return parsed.success ? parsed.data.notes?.trim() || null : null;
}

function toIsoString(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string") return value;
	return null;
}

/** Degenerate no-alerts case (hand-authored incident): the incident itself is the alert. */
function incidentAsAlert(
	incident: Record<string, unknown> | null,
): FiringAlert {
	const title = incident?.title ? String(incident.title) : "Incident";
	return {
		alertname: title,
		severity: incident?.severity ? String(incident.severity) : "unknown",
		labels: {},
		annotations: incident?.description
			? { description: String(incident.description) }
			: {},
		startsAt: toIsoString(incident?.triggeredAt),
	};
}

function incidentMeta(incident: Record<string, unknown>): IncidentContext {
	const startedAt = toIsoString(incident.triggeredAt);
	return {
		...(incident.title ? { title: String(incident.title) } : {}),
		...(incident.description
			? { description: String(incident.description) }
			: {}),
		...(incident.severity ? { severity: String(incident.severity) } : {}),
		...(startedAt ? { startedAt } : {}),
	};
}

function successResult(
	data: InvestigationJobData,
	report: InvestigationReport,
): InvestigationResult {
	return {
		success: true,
		investigationId: data.investigationId,
		incidentId: data.incidentId,
		findings: {
			rootCause: report.rootCause ?? undefined,
			summary: report.summary,
		},
		recommendations: [],
	};
}

/** A chat ended its turn: success, and nothing to report (#673). */
function chatResult(data: InvestigationJobData): InvestigationResult {
	return {
		success: true,
		investigationId: data.investigationId,
		incidentId: data.incidentId,
		findings: {},
		recommendations: [],
	};
}

function failureResult(
	data: InvestigationJobData,
	error: string,
): InvestigationResult {
	return {
		success: false,
		investigationId: data.investigationId,
		incidentId: data.incidentId,
		findings: {},
		recommendations: [],
		error,
	};
}

function cancelledResult(data: InvestigationJobData): InvestigationResult {
	return {
		success: false,
		investigationId: data.investigationId,
		incidentId: data.incidentId,
		findings: {},
		recommendations: [],
		error: "Investigation cancelled",
		errorType: "cancelled",
	};
}
