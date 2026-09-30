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
	getHarnessProviderKeys,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
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
	type RunWorkspace,
	type RunWorkspaceRepo,
	RunWorkspaceSchema,
	toFiringAlert,
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

		const { selection, model, modelSource } = await ports.resolveHarness();
		if (!selection.runnable) throw new Error(selection.reason);
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
			workspace: JSON.stringify(toRunWorkspace(workspace)),
		});
		const harness = selection.harness;
		const outcome = await conductRun(
			{
				runId,
				context,
				harness: selection.harness,
				cwd: workspace.cwd,
				runDir,
				...(model ? { model } : {}),
				...(modelSource ? { modelSource } : {}),
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
				...(data.brief ? { brief: data.brief } : {}),
				onSession: (s) => keepSession(ports, runId, harness, s),
			},
			{ sink, store },
		);
		await io.streamDone();

		if (outcome.failureKind === "cancelled") {
			logger.info(`Job ${job.id} cancelled`);
			try {
				await persistCancelled(data, ports);
			} catch (e) {
				logger.error("Failed to persist cancelled status", e);
			}
			return cancelledResult(data);
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
				await persistCancelled(parsed.data, ports);
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
				await ports.updateStatus(investigationId, {
					status: "failed",
					error: errorMessage,
				});
				if (incidentId) {
					await ports.createTimelineEntry({
						incidentId,
						type: "investigation_completed",
						title: "Investigation failed",
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
 * first run's workspace, rebuilt at the same path and commits (#747). Chat
 * only: the report, the incident and deliveries never change, and the row's
 * status, completedAt and error are put back when it ends.
 */
async function runFollowUp(
	rawPayload: InvestigationJobData,
	io: JobIo,
	ports: RunPorts,
): Promise<InvestigationResult> {
	const data = InvestigationJobDataSchema.parse(rawPayload);
	const resume = data.resume as NonNullable<InvestigationJobData["resume"]>;
	const id = data.investigationId;
	const runDir = runDirFor(id);
	let restored = false;
	const restore = async (): Promise<void> => {
		if (restored) return;
		restored = true;
		try {
			await ports.followUpStatus(id, {
				status: resume.restore.status,
				completedAt: resume.restore.completedAt
					? new Date(resume.restore.completedAt)
					: null,
				error: resume.restore.error,
			});
		} catch (e) {
			logger.error("Failed to put the investigation back after a follow-up", e);
		}
	};
	let seqStart = 0;
	try {
		seqStart = (await ports.lastEventSeq(id)) + 1;
		const inv = await ports.findInvestigation(id);
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
		const context = await assembleInvestigationContext(incident, data);
		const multi = workspaceContext(workspace);
		if (multi) context.workspace = multi;

		mkdirSync(runDir, { recursive: true });
		const store = createPrismaInvestigationStore(ports, {
			investigationId: id,
			incidentId: data.incidentId,
			runId: id,
			resume: { note: workspace.note },
		});
		const outcome = await conductRun(
			{
				runId: id,
				context,
				harness,
				cwd: workspace.cwd,
				runDir,
				...(inv.model ? { model: inv.model } : {}),
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
				resume: {
					sessionId: inv.acpSessionId,
					text: resume.text,
					mode: resume.mode,
					heads: workspace.repos.map((r) => ({ name: r.name, head: r.head })),
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
		await restore();
		await io.streamDone();
		if (outcome.failureKind === "cancelled") return cancelledResult(data);
		if (outcome.error) return failureResult(data, outcome.error);
		return {
			success: true,
			investigationId: id,
			incidentId: data.incidentId,
			findings: {},
			recommendations: [],
		};
	} catch (error: unknown) {
		const message = io.signal.aborted
			? "investigation cancelled"
			: error instanceof Error
				? error.message
				: String(error);
		logger.error(`Follow-up failed: ${message}`, error);
		await sayInConversation(id, seqStart, resume, message, io, ports);
		await restore();
		return io.signal.aborted
			? cancelledResult(data)
			: failureResult(data, message);
	} finally {
		await restore();
		clearRunWorkspace(runDir);
	}
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
	// One at a time: every clone lands on the same disk.
	for (const [i, { repo, services }] of repos.entries()) {
		const name = names[i] as string;
		const token = repo.connectionId
			? await ports.repoToken(repo.connectionId).catch(() => null)
			: null;
		const snap = await ports.snapshot(
			{
				kind: repo.sourceKind,
				source: repo.url,
				defaultBranch: repo.defaultBranch,
				token,
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
		});
	}
	if (!multi) {
		const [only] = taken as [RunWorkspaceRepo];
		return {
			layout: "single",
			cwd: inside(only.dir, only.subPath),
			repos: taken,
			note: `Investigating a snapshot of ${whereFrom(only)} at ${only.branch ? `${only.branch} ` : ""}${only.head.slice(0, 12)}. Uncommitted changes are not included.`,
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
		note: `Investigating snapshots of ${taken.length} repositories: ${listing}. Uncommitted changes are not included.`,
	};
}

/**
 * The first run's workspace again, at the same paths and commits: harness
 * session stores are keyed by directory (anthropics/claude-code#58591, #747).
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
	for (const repo of ws.repos) {
		inside(runDir, relative(runDir, repo.dir));
		if (!/^[0-9a-f]{7,64}$/i.test(repo.head))
			throw new Error(`Recorded commit is not a commit id: ${repo.head}`);
		const token = repo.connectionId
			? await ports.repoToken(repo.connectionId).catch(() => null)
			: null;
		await ports.snapshot(
			{ kind: repo.sourceKind, source: repo.url, token },
			repo.dir,
			signal,
			repo.head,
		);
	}
	mkdirSync(ws.cwd, { recursive: true });
	const pinned =
		ws.repos.length === 1
			? (ws.repos[0] as RunWorkspaceRepo).head.slice(0, 7)
			: ws.repos.map((r) => `${r.name}@${r.head.slice(0, 7)}`).join(", ");
	return {
		...ws,
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

async function persistCancelled(
	data: InvestigationJobData,
	ports: RunPorts,
): Promise<void> {
	await ports.updateStatus(data.investigationId, {
		status: "cancelled",
		error: "Investigation cancelled",
	});
	await ports.createTimelineEntry({
		incidentId: data.incidentId,
		type: "investigation_completed",
		title: "Investigation stopped",
		description: "The investigation was cancelled before it completed.",
		source: "ai_worker",
		metadata: { investigationId: data.investigationId },
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
		| { name?: string; tier?: string }
		| null
		| undefined;
	const telemetry = telemetryEndpointsFrom(connectors, (m) => logger.warn(m));
	return correlatedAlertsContext(firingAlerts, telemetry, {
		incident: incident ? incidentMeta(incident) : undefined,
		...(service?.name
			? {
					service: {
						name: service.name,
						...(service.tier ? { tier: service.tier } : {}),
					},
				}
			: {}),
		...(contextPack ? { contextPack } : {}),
	});
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
