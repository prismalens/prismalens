// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One investigation job: detect the harness, clone the incident's repo under the
 * app-data dir, run one ACP session there, persist the stream and the report
 * (ADR 0002, 0003, 0005). No model call; no user checkout as cwd.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDir } from "@prismalens/config";
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
	EffortEstimate,
	RecommendationCategory,
	RecommendationPriority,
	Urgency,
} from "@prismalens/contracts/schemas";
import {
	conductRun,
	type InvestigationSink,
	resolveSandbox,
	SANDBOX_MODES,
	type Sandbox,
	type SandboxMode,
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
	let sandbox: Sandbox | undefined;
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

		const { selection, model } = await ports.resolveHarness();
		if (!selection.runnable) throw new Error(selection.reason);
		logger.info(
			`harness: ${selection.harness} (${selection.auto ? "auto" : "pinned"}${selection.verified ? "" : ", unverified"})`,
		);

		let incident: Record<string, unknown> | null = null;
		try {
			incident = await ports.getIncident(data.incidentId);
		} catch {
			incident = null;
		}
		const context = assembleInvestigationContext(incident, data);
		const workspace = await resolveWorkspace(data, ports);
		await recordWorkspace(data, workspace, ports);

		const sandboxMode = parseSandboxMode(process.env.PRISMALENS_SANDBOX);
		const sandboxSelection = await resolveSandbox(sandboxMode, {
			allowedDomains: deriveAllowedHosts(context),
			...(probeUrl(context) ? { probeUrl: probeUrl(context) as string } : {}),
		});
		if (sandboxSelection.degradeReason) {
			logger.warn(
				`Sandbox '${sandboxMode}' degraded to ${sandboxSelection.actual}: ${sandboxSelection.degradeReason}`,
			);
		}
		sandbox = sandboxSelection.sandbox;

		const runId = data.investigationId;
		const runDir = join(getAppDataDir(), "runs", runId);
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
				env: process.env,
				sandbox,
				requestedSandbox: sandboxMode,
				limits: { wallClockMs: INVESTIGATION_DEFAULTS.harnessWallClockMs },
				initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
				promptTimeoutMs: INVESTIGATION_DEFAULTS.harnessWallClockMs,
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
		if (sandbox) {
			try {
				await sandbox.destroy();
			} catch (e) {
				logger.error("Failed to destroy sandbox boundary", e);
			}
		}
	}
}

export interface Workspace {
	cwd: string;
	mapped: boolean;
	note: string;
	repo?: IncidentRepo;
	head?: string;
}

/**
 * The harness runs in prismalens's own clone of the incident's primary repo.
 * No linked repo means an UNMAPPED run in an empty scratch dir that says so;
 * a run against the wrong tree produces confident garbage.
 */
export async function resolveWorkspace(
	data: InvestigationJobData,
	ports: RunPorts,
): Promise<Workspace> {
	let repos: IncidentRepo[] = [];
	try {
		repos = await ports.incidentRepos(data.incidentId);
	} catch (e) {
		logger.warn("Could not list the incident's repos", e);
	}
	const repo = repos[0];
	if (!repo) {
		const cwd = join(getAppDataDir(), "runs", data.investigationId, "unmapped");
		mkdirSync(cwd, { recursive: true });
		return {
			cwd,
			mapped: false,
			note: "Ran UNMAPPED: this incident's service has no repository linked. Add the repo URL to the service; findings below cannot describe the code that alerted.",
		};
	}
	const token = repo.connectionId
		? await ports.repoToken(repo.connectionId).catch(() => null)
		: null;
	const clone = await ports.ensureClone({
		url: repo.url,
		defaultBranch: repo.defaultBranch,
		token,
	});
	const cwd = repo.subPath ? join(clone.path, repo.subPath) : clone.path;
	return {
		cwd,
		mapped: true,
		repo,
		head: clone.head,
		note: `Investigating ${repo.url}${repo.subPath ? `/${repo.subPath}` : ""} at ${clone.head.slice(0, 12)} (${clone.action}).`,
	};
}

async function recordWorkspace(
	data: InvestigationJobData,
	ws: Workspace,
	ports: RunPorts,
): Promise<void> {
	try {
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

export function parseSandboxMode(raw: string | undefined): SandboxMode {
	const value = raw ?? "auto";
	if ((SANDBOX_MODES as readonly string[]).includes(value))
		return value as SandboxMode;
	throw new Error(
		`Invalid PRISMALENS_SANDBOX="${raw}" — expected one of ${SANDBOX_MODES.join("|")}.`,
	);
}

/**
 * Egress allowlist for an enforced sandbox: the configured telemetry hosts plus
 * PRISMALENS_SANDBOX_ALLOWED_HOSTS (comma-separated), where the harness's model
 * provider lives. The process floor ignores this.
 */
export function deriveAllowedHosts(context: InvestigationContext): string[] {
	const hosts = new Set<string>();
	for (const url of telemetryUrls(context)) {
		try {
			hosts.add(new URL(url).hostname);
		} catch {
			// unparseable endpoint grants no egress
		}
	}
	for (const h of (process.env.PRISMALENS_SANDBOX_ALLOWED_HOSTS ?? "").split(
		",",
	)) {
		const host = h.trim();
		if (host) hosts.add(host);
	}
	return [...hosts];
}

function telemetryUrls(context: InvestigationContext): string[] {
	const t = context.telemetry;
	return [
		t?.prometheusUrl,
		t?.alertmanagerUrl,
		t?.apiUrl,
		context.logs?.url,
	].filter((u): u is string => typeof u === "string" && u.length > 0);
}

function probeUrl(context: InvestigationContext): string | undefined {
	for (const url of telemetryUrls(context)) {
		try {
			return new URL(url).href;
		} catch {
			// skip
		}
	}
	return undefined;
}

function assembleInvestigationContext(
	incident: Record<string, unknown> | null,
	data: InvestigationJobData,
): InvestigationContext {
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
	return correlatedAlertsContext(firingAlerts, undefined, {
		incident: incident ? incidentMeta(incident) : undefined,
		...(service?.name
			? {
					service: {
						name: service.name,
						...(service.tier ? { tier: service.tier } : {}),
					},
				}
			: {}),
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
