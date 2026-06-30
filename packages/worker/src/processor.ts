/**
 * Investigation job processor (ADR-0008/0010/0011 — Phase A).
 *
 * Drives the two-tier engine (`@prismalens/engine`) instead of the retired
 * LangGraph `@prismalens/agents`: resolve the engine inputs from the job + LLM
 * settings (shell-first, ADR-0005 — connectors come in Phase D), then
 * `conductInvestigation` with a Redis SINK that publishes the canonical stream for
 * the API to relay (→ SSE → UI). The terminal ordered-evidence report is persisted
 * via `api.investigations.writeResult`.
 *
 * Phase A note: telemetry endpoints + harness cwd are sourced from
 * INVESTIGATION_DEFAULTS + env as a local-first stopgap; the full `pl.config.yaml`
 * sourcing (materialised by the web Settings UI) lands with the config-UI work.
 */
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import type { InvestigationReport } from "@prismalens/contracts";
import {
	conductInvestigation,
	type InvestigationRequest,
	resolveInvestigation,
} from "@prismalens/engine";
import { Logger, enrichContext } from "@prismalens/logger";
import { runWithWideEvent } from "@prismalens/logger/standalone";
import type { SandboxedJob } from "bullmq";
import { Redis } from "ioredis";
import { config as workerConfig, redisUrl } from "./config.js";
import { api } from "./orpc-client.js";
import type { InvestigationJobData, InvestigationResult } from "./types.js";

const logger = new Logger({ context: "InvestigationProcessor" });

// Redis publisher for streaming canonical events to the API relay.
const redisPublisher = new Redis(redisUrl, {
	maxRetriesPerRequest: null,
});

/**
 * Fetch LLM configuration from the API (active provider, model, api-key creds).
 * SECURITY: the api key only lives in-memory during execution.
 */
async function fetchLlmConfig(): Promise<{
	provider: string | null;
	model: string | null;
	credentials: Record<string, string>;
}> {
	const internalSecret = process.env.PRISMALENS_INTERNAL_SECRET;
	if (!internalSecret) {
		throw new Error(
			"PRISMALENS_INTERNAL_SECRET not set — cannot fetch LLM config",
		);
	}

	const url = new URL(
		"/internal/settings/llm-credentials",
		workerConfig.PRISMALENS_WORKER_API_URL,
	);

	const response = await fetch(url.toString(), {
		headers: {
			"X-Internal-Secret": internalSecret,
			"User-Agent": "prismalens-worker/0.1.0",
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(
			`Failed to fetch LLM config from API: ${response.status} ${response.statusText}`,
		);
	}

	return response.json() as Promise<{
		provider: string | null;
		model: string | null;
		credentials: Record<string, string>;
	}>;
}

/**
 * Process an investigation job from the queue.
 */
export default async function processInvestigationJob(
	job: SandboxedJob<InvestigationJobData, InvestigationResult>,
): Promise<InvestigationResult> {
	const { data } = job;
	return runWithWideEvent(
		`job-${job.id}`,
		async () => processJobInternal(job, data),
		{
			context: {
				job_id: job.id,
				job_name: job.name,
				investigation_id: data.investigationId,
				incident_id: data.incidentId,
			},
		},
	);
}

async function processJobInternal(
	job: SandboxedJob<InvestigationJobData, InvestigationResult>,
	data: InvestigationJobData,
): Promise<InvestigationResult> {
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
		// 1. runId == the investigation id; mark running.
		const runId = data.investigationId;
		await api.investigations.updateStatus({
			id: data.investigationId,
			status: "running",
			harnessThreadId: runId,
		});

		// 2. Timeline entry.
		await api.timeline.create({
			incidentId: data.incidentId,
			type: "investigation_started",
			title: "AI Investigation Started",
			description: "Starting the two-tier engine investigation",
			source: "ai_worker",
			metadata: { investigationId: data.investigationId },
		});

		// 3. Resolve engine inputs (shell-first; BYO-key from LLM settings).
		const resolved = resolveInvestigation(await buildRequest(data, runId));

		await job.updateProgress({ percent: 5, message: "Starting investigation..." });

		// 4. Conduct: drive the harness, publishing the canonical stream to Redis.
		const channel = `investigation:events:${data.investigationId}`;
		const outcome = await conductInvestigation(
			{
				alert: resolved.alert,
				telemetry: resolved.telemetry,
				harness: resolved.harness,
				synth: resolved.synth,
				runId,
			},
			async (event) => {
				await redisPublisher.publish(channel, JSON.stringify(event));
			},
		);
		// Terminal sentinel for the API relay.
		await redisPublisher.publish(channel, JSON.stringify(["__done__", {}]));

		await job.updateProgress({ percent: 90, message: "Persisting results..." });

		// 5a. No-evidence / failed branch → surface the failure, don't fabricate.
		if (!outcome.report) {
			const message = outcome.error ?? "investigation produced no evidence";
			await api.investigations.updateStatus({
				id: data.investigationId,
				status: "failed",
				error: message,
			});
			await api.timeline.create({
				incidentId: data.incidentId,
				type: "investigation_completed",
				title: "AI Investigation Failed",
				description: message,
				source: "ai_worker",
				metadata: { investigationId: data.investigationId, error: message },
			});
			return failureResult(data, message);
		}

		// 5b. Persist the full ordered-evidence report JSON plus the flattened
		// summary/rootCause and the next-steps as relational Recommendation rows.
		const report = outcome.report;
		await api.investigations.writeResult({
			id: data.investigationId,
			status: "completed",
			summary: report.summary,
			rootCause: report.rootCause ?? undefined,
			rootCauseCategory: report.rootCauseCategory ?? undefined,
			report,
			recommendations: report.nextSteps.map((step) => ({
				title: step.title,
				description: step.detail,
				priority: step.priority ?? undefined,
				category: "investigation",
				actionable: true,
			})),
		});

		await job.updateProgress({ percent: 100, message: "Investigation complete" });
		logger.info(`Job ${job.id} completed`);
		return successResult(data, report);
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Job failed: ${errorMessage}`, error);
		try {
			await api.investigations.updateStatus({
				id: data.investigationId,
				status: "failed",
				error: errorMessage,
			});
			await api.timeline.create({
				incidentId: data.incidentId,
				type: "investigation_completed",
				title: "AI Investigation Failed",
				description: errorMessage,
				source: "ai_worker",
				metadata: { investigationId: data.investigationId, error: errorMessage },
			});
		} catch (e) {
			logger.error("Failed to update failure status", e);
		}
		throw error;
	}
}

/**
 * Build the engine investigation request from the job + LLM settings.
 * Shell-first (ADR-0005): telemetry + cwd from INVESTIGATION_DEFAULTS/env (Phase A
 * stopgap); connectors are Phase D. BYO-key (ADR-0006) from the LLM settings.
 */
async function buildRequest(
	data: InvestigationJobData,
	_runId: string,
): Promise<InvestigationRequest> {
	const llmConfig = await fetchLlmConfig();
	if (!llmConfig?.provider || !llmConfig?.model) {
		throw new Error(
			"LLM not configured: no active provider/model. Configure via Settings " +
				"or set PRISMALENS_LLM_PROVIDER + PRISMALENS_LLM_MODEL.",
		);
	}
	const apiKey = Object.values(llmConfig.credentials ?? {})[0] ?? "";
	if (!apiKey) {
		throw new Error(
			`LLM API key not configured for provider "${llmConfig.provider}".`,
		);
	}

	let incident: Record<string, unknown> | null = null;
	try {
		incident = (await api.incidents.get({
			id: data.incidentId,
		})) as unknown as Record<string, unknown>;
	} catch {
		incident = null;
	}

	const baseURL = INVESTIGATION_DEFAULTS.synth.baseURL;
	return {
		alert: buildAlertPayload(incident, data),
		harness: process.env.PRISMALENS_HARNESS ?? "deepagents",
		model: llmConfig.model,
		cwd: process.env.PRISMALENS_INVESTIGATION_CWD ?? process.cwd(),
		telemetry: { ...INVESTIGATION_DEFAULTS.telemetry },
		synth: { baseURL, apiKey, model: llmConfig.model },
		harnessEnv: { OPENAI_API_KEY: apiKey, OPENAI_BASE_URL: baseURL },
		initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
	};
}

/** Map the incident + seed alerts into a FiringAlert-shaped payload. */
function buildAlertPayload(
	incident: Record<string, unknown> | null,
	data: InvestigationJobData,
): Record<string, unknown> {
	const firstAlert = (data.alerts?.[0] ?? {}) as Record<string, unknown>;
	const labels = (firstAlert.labels as Record<string, string>) ?? {};
	const annotations: Record<string, string> = {};
	if (incident?.description) annotations.description = String(incident.description);
	if (firstAlert.description) annotations.summary = String(firstAlert.description);
	return {
		alertname:
			(incident?.title as string) ??
			(firstAlert.title as string) ??
			(firstAlert.alertname as string) ??
			"Incident investigation",
		severity:
			(incident?.severity as string) ??
			(firstAlert.severity as string) ??
			labels.severity ??
			"unknown",
		labels,
		annotations,
		startsAt:
			(incident?.triggeredAt as string) ??
			(firstAlert.triggeredAt as string) ??
			(firstAlert.startsAt as string) ??
			null,
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
		agentExecutions: [],
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
		agentExecutions: [],
		error,
	};
}

/** Graceful shutdown — close the Redis publisher. */
async function closeProcessor(): Promise<void> {
	await redisPublisher.quit();
}

process.on("SIGTERM", async () => {
	await closeProcessor();
	process.exit(0);
});
