/**
 * Investigation job processor (ADR-0008/0010/0011 — Phase A).
 *
 * Drives the two-tier engine (`@prismalens/engine`) instead of the retired
 * LangGraph `@prismalens/agents`: resolve the engine inputs from the job + LLM
 * settings (shell-first, ADR-0005 — connectors come in Phase D), then
 * `conductRun` (ADR-0018) with a Redis SINK that publishes the canonical stream for
 * the API to relay (→ SSE → UI), and a DB STORE that folds the lifecycle
 * (status/timeline/result) via `api.investigations.writeResult`.
 *
 * Phase A note: telemetry endpoints + harness cwd are sourced from
 * INVESTIGATION_DEFAULTS + env as a local-first stopgap; the full `pl.config.yaml`
 * sourcing (materialised by the web Settings UI) lands with the config-UI work.
 */
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import type { LLMProviderId } from "@prismalens/config/llm";
import type {
	FiringAlert,
	IncidentContext,
	InvestigationContext,
	InvestigationReport,
	TelemetryEndpoints,
} from "@prismalens/contracts";
import {
	conductRun,
	type InvestigationRequest,
	type InvestigationSink,
	resolveInvestigation,
} from "@prismalens/engine";
import { enrichContext, Logger } from "@prismalens/logger";
import { runWithWideEvent } from "@prismalens/logger/standalone";
import type { SandboxedJob } from "bullmq";
import { Redis } from "ioredis";
import { redisUrl, config as workerConfig } from "./config.js";
import { createDbInvestigationStore } from "./db-investigation-store.js";
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
	baseUrl: string | null;
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
		baseUrl: string | null;
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
		// 1. runId == the investigation id.
		const runId = data.investigationId;

		// 2. Resolve engine inputs (shell-first; BYO-key from LLM settings).
		const resolved = resolveInvestigation(await buildRequest(data, runId));

		await job.updateProgress({
			percent: 5,
			message: "Starting investigation...",
		});

		// 3. Conduct: drive the harness once through the shared primitive
		// (ADR-0018), fanning the canonical stream to Redis (live/ephemeral) and
		// folding the lifecycle through the DB store (durable — status/timeline/
		// result). conductRun owns create → append → finish|fail; it never throws
		// on a failed branch (see the outer catch for unexpected transport errors).
		const channel = `investigation:events:${data.investigationId}`;
		const sink: InvestigationSink = async (event) => {
			await redisPublisher.publish(channel, JSON.stringify(event));
		};
		const store = createDbInvestigationStore(api, {
			investigationId: data.investigationId,
			incidentId: data.incidentId,
			runId,
		});
		const outcome = await conductRun(
			{
				context: resolved.context,
				harness: resolved.harness,
				synth: resolved.synth,
				fidelity: resolved.fidelity,
				runId,
			},
			{ sink, store },
		);
		// Terminal sentinel for the API relay.
		await redisPublisher.publish(channel, JSON.stringify(["__done__", {}]));

		await job.updateProgress({ percent: 90, message: "Persisting results..." });

		// 4a. No-evidence / failed branch → the store already recorded the
		// failure; just surface it as the job result, don't fabricate.
		if (!outcome.report) {
			return failureResult(
				data,
				outcome.error ?? "investigation produced no evidence",
			);
		}

		// 4b. The store already persisted the full ordered-evidence report JSON
		// plus the flattened summary/rootCause and the next-steps as relational
		// Recommendation rows.
		await job.updateProgress({
			percent: 100,
			message: "Investigation complete",
		});
		logger.info(`Job ${job.id} completed`);
		return successResult(data, outcome.report);
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
				metadata: {
					investigationId: data.investigationId,
					error: errorMessage,
				},
			});
		} catch (e) {
			logger.error("Failed to update failure status", e);
		}
		throw error;
	}
}

/**
 * Derive the `deepagents` harness env from the active Tier-1 provider (ADR-0013
 * scope boundary: deepagents only speaks the OpenAI protocol via `OPENAI_*` env,
 * so both vars must be gated the same way — leaking `apiKey` into `OPENAI_API_KEY`
 * for a non-OpenAI-shaped provider (anthropic/google/groq) would hand the harness a
 * secret it can't use and silently mis-wire it (worker-provider-hardwiring ledger
 * item). `openai` itself always qualifies; ollama/custom qualify because they speak
 * the OpenAI protocol too (and additionally need the base URL to leave localhost).
 */
export function speaksOpenAiProtocol(provider: LLMProviderId): boolean {
	return (
		provider === "openai" || provider === "ollama" || provider === "custom"
	);
}

export function buildHarnessEnv(
	synthProvider: LLMProviderId,
	apiKey: string,
	baseURL: string,
): Record<string, string> {
	const isOpenAiCompat =
		synthProvider === "ollama" || synthProvider === "custom";
	return {
		...(speaksOpenAiProtocol(synthProvider) ? { OPENAI_API_KEY: apiKey } : {}),
		...(isOpenAiCompat ? { OPENAI_BASE_URL: baseURL } : {}),
	};
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

	// The user-configured base URL (validated server-side against the provider
	// allowlist) wins; the hardcoded default is only the last resort for an
	// unconfigured ollama-cloud setup. Without this, `custom` and ollama-local
	// deployments were silently pointed at the default endpoint.
	const baseURL = llmConfig.baseUrl ?? INVESTIGATION_DEFAULTS.synth.baseURL;
	// Tier-1 reduce runs on the user's chosen provider (ADR-0013 resolver); a base
	// URL is only needed for the OpenAI-compatible providers (ollama/custom).
	const synthProvider = llmConfig.provider as LLMProviderId;
	const synthIsOpenAiCompat =
		synthProvider === "ollama" || synthProvider === "custom";
	const harness = process.env.PRISMALENS_HARNESS ?? "deepagents";
	// deepagents only speaks the OpenAI protocol (ADR-0013 scope boundary): fail
	// the job with a clear reason up front instead of dispatching a run that dies
	// deep in the harness with an opaque missing-credential error.
	if (harness === "deepagents" && !speaksOpenAiProtocol(synthProvider)) {
		throw new Error(
			`Harness "deepagents" only supports OpenAI-protocol providers ` +
				`(openai/ollama/custom); active provider is "${synthProvider}". ` +
				`Switch provider or set PRISMALENS_HARNESS to a harness that ` +
				`supports it (e.g. claude-code for anthropic).`,
		);
	}
	return {
		context: assembleInvestigationContext(incident, data, {
			...INVESTIGATION_DEFAULTS.telemetry,
		}),
		harness,
		// The single posture dial (ADR-0017): the worker is always read-only in
		// Phase A — no per-run override, no native passthrough.
		permissionMode: "read-only",
		model: llmConfig.model,
		cwd: process.env.PRISMALENS_INVESTIGATION_CWD ?? process.cwd(),
		synth: {
			providerId: synthProvider,
			model: llmConfig.model,
			apiKey,
			...(synthIsOpenAiCompat ? { baseURL } : {}),
		},
		harnessEnv: buildHarnessEnv(synthProvider, apiKey, baseURL),
		initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
	};
}

/**
 * Assemble the host investigation context (ADR-0015) from the incident + ALL seed
 * alerts — replacing the old lossy single-alert collapse (which discarded every
 * alert but `[0]` and folded the incident title INTO the alert name). Each alert
 * keeps its own identity; the incident meta rides in `context.incident`. Richer
 * enrichment (service graph, prior investigations from the DB) is a later slice
 * (ADR-0016 §5), which the app/API — not the worker — will own.
 */
function assembleInvestigationContext(
	incident: Record<string, unknown> | null,
	data: InvestigationJobData,
	telemetry: TelemetryEndpoints,
): InvestigationContext {
	const rows = (data.alerts ?? []) as Record<string, unknown>[];
	const alerts: FiringAlert[] =
		rows.length > 0 ? rows.map(toFiringAlert) : [incidentAsAlert(incident)];
	return {
		alerts,
		telemetry,
		...(incident ? { incident: incidentMeta(incident) } : {}),
	};
}

/** Map a DB alert row into a FiringAlert projection. */
function toFiringAlert(row: Record<string, unknown>): FiringAlert {
	const labels = (row.labels as Record<string, string>) ?? {};
	const annotations: Record<string, string> = {};
	if (row.description) annotations.summary = String(row.description);
	return {
		alertname: (row.title as string) ?? (row.alertname as string) ?? "Alert",
		severity: (row.severity as string) ?? labels.severity ?? null,
		labels,
		annotations,
		startsAt: (row.triggeredAt as string) ?? (row.startsAt as string) ?? null,
	};
}

/** Degenerate no-alerts case: project the incident itself into a single alert. */
function incidentAsAlert(
	incident: Record<string, unknown> | null,
): FiringAlert {
	return {
		alertname: (incident?.title as string) ?? "Incident investigation",
		severity: (incident?.severity as string) ?? null,
		labels: {},
		annotations: incident?.description
			? { description: String(incident.description) }
			: {},
		startsAt: (incident?.triggeredAt as string) ?? null,
	};
}

/** Project incident meta (framing only — no lifecycle fields, ADR-0015). */
function incidentMeta(incident: Record<string, unknown>): IncidentContext {
	return {
		...(incident.title ? { title: String(incident.title) } : {}),
		...(incident.description
			? { description: String(incident.description) }
			: {}),
		...(incident.severity ? { severity: String(incident.severity) } : {}),
		...(incident.triggeredAt
			? { startedAt: String(incident.triggeredAt) }
			: {}),
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
