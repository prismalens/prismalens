// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One investigation job: detect the harness, snapshot the incident's repo into the
 * run dir, run one ACP session there, persist the stream and the report
 * (ADR 0002, 0003, 0005). No model call; no user checkout as cwd.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getAppDataDir } from "@prismalens/config";
import { getHarnessProviderKeys } from "@prismalens/config/harness";
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
	telemetryEndpointsFrom,
} from "@prismalens/engine";
import { enrichContext, Logger } from "@prismalens/logger";
import { runWithWideEvent } from "@prismalens/logger/standalone";
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
		});
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
						title: "AI Investigation Failed",
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
			const runDir = runDirFor(unvalidated.investigationId);
			for (const rel of ["repo", "home", join("config", "node_modules")]) {
				try {
					rmSync(join(runDir, rel), { recursive: true, force: true });
				} catch (e) {
					logger.warn(`Failed to remove the run's ${rel}`, e);
				}
			}
		}
	}
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

export interface Workspace {
	cwd: string;
	mapped: boolean;
	note: string;
	repo?: IncidentRepo;
	head?: string;
}

/**
 * The harness runs in a fresh snapshot of the incident's primary repo under the
 * run's own dir (ADR 0004 §2). No linked repo means an UNMAPPED run in an empty
 * scratch dir that says so; a run against the wrong tree produces confident garbage.
 */
export async function resolveWorkspace(
	data: InvestigationJobData,
	ports: RunPorts,
	signal?: AbortSignal,
): Promise<Workspace> {
	let repos: IncidentRepo[] = [];
	try {
		repos = await ports.incidentRepos(data.incidentId);
	} catch (e) {
		logger.warn("Could not list the incident's repos", e);
	}
	const runDir = runDirFor(data.investigationId);
	const repo = repos[0];
	if (!repo) {
		const cwd = join(runDir, "unmapped");
		mkdirSync(cwd, { recursive: true });
		return {
			cwd,
			mapped: false,
			note: "Ran UNMAPPED: this incident's service has no repository linked. Set the Repository field on the service to a folder path or git URL; findings below cannot describe the code that alerted.",
		};
	}
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
		join(runDir, "repo"),
		signal,
	);
	const cwd = repo.subPath ? resolve(snap.path, repo.subPath) : snap.path;
	const inside = relative(snap.path, cwd);
	if (inside.startsWith("..") || resolve(snap.path, inside) !== cwd)
		throw new Error(
			`Repository sub-path escapes the snapshot: ${repo.subPath}`,
		);
	const from = repo.sourceKind === "folder" ? "folder" : "URL";
	return {
		cwd,
		mapped: true,
		repo,
		head: snap.head,
		note: `Investigating a snapshot of ${from} ${repo.url}${repo.subPath ? `/${repo.subPath}` : ""} at ${snap.branch ? `${snap.branch} ` : ""}${snap.head.slice(0, 12)}. Uncommitted changes are not included.`,
	};
}

async function recordWorkspace(
	data: InvestigationJobData,
	ws: Workspace,
	ports: RunPorts,
	context?: InvestigationContext,
): Promise<void> {
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
			title: ws.mapped
				? "Investigating the service's repository"
				: "Investigating WITHOUT a linked repository",
			description: ws.note,
			source: "ai_worker",
			metadata: {
				investigationId: data.investigationId,
				cwd: ws.cwd,
				mapped: ws.mapped,
				...(ws.repo ? { repo: ws.repo.url } : {}),
				...(ws.head ? { head: ws.head } : {}),
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
		title: "Investigation cancelled",
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
