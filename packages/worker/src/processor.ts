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
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/llm";
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
	resolveSandbox,
	SANDBOX_MODES,
	type Sandbox,
	type SandboxMode,
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
 * Clear the durable canonical event record for an investigation (ADR-0018 B.4) before a
 * BullMQ RETRY. Attempt 2+ would otherwise collide with attempt 1's rows on
 * `(investigationId, branchId, seq)` and be dropped as duplicates (P2002), leaving the
 * record showing the FAILED attempt's events. Same X-Internal-Secret pattern as the
 * bulk-append/LLM-config fetch. Throws on a missing secret or non-2xx so the caller can
 * log it (best-effort — a clear failure must not block the retry).
 */
async function clearDurableEvents(investigationId: string): Promise<void> {
	const internalSecret = process.env.PRISMALENS_INTERNAL_SECRET;
	if (!internalSecret) {
		// No secret ⇒ the durable record was never written (poster throws on every
		// flush), so there is nothing to clear.
		return;
	}
	const url = new URL(
		`/internal/investigations/${investigationId}/events/clear`,
		workerConfig.PRISMALENS_WORKER_API_URL,
	);
	const response = await fetch(url.toString(), {
		method: "POST",
		headers: {
			"X-Internal-Secret": internalSecret,
			"User-Agent": "prismalens-worker/0.1.0",
		},
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(
			`clear-events failed: ${response.status} ${response.statusText}`,
		);
	}
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

	// The isolation boundary (ADR-0020) is CALLER-OWNED — the acp-client will not
	// destroy a caller-supplied sandbox (it may span branches, B.2), so the worker owns
	// its teardown in the finally below. Especially load-bearing for `e2b`: a leaked
	// remote VM keeps costing until its timeout.
	let sandbox: Sandbox | undefined;
	// Cooperative cancellation (CANCEL slice, ADR-0018): a DEDICATED Redis subscriber
	// listens on this job's cancel channel; a message aborts the run's AbortSignal, which
	// conductRun threads into the engine (stop consuming the merged stream → cascade the
	// child kill + run-owned sandbox teardown). The subscription is torn down in the
	// finally. A subscriber connection cannot also publish, hence a connection of its own.
	const abortController = new AbortController();
	const cancelChannel = `investigation:cancel:${data.investigationId}`;
	const cancelSubscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
	try {
		cancelSubscriber.on("message", (channel: string) => {
			if (channel === cancelChannel) {
				logger.info(
					`Cancel requested for investigation ${data.investigationId}`,
				);
				abortController.abort();
			}
		});
		await cancelSubscriber.subscribe(cancelChannel);

		// BullMQ RETRY (attempt 2+): the prior attempt left a stale durable event record
		// whose rows would collide with this attempt's on (investigationId, branchId, seq)
		// and be swallowed as duplicates — so the record would show the FAILED attempt's
		// events. Clear it so each attempt owns a fresh record. Best-effort: a clear
		// failure logs and proceeds (never blocks the retry).
		if (job.attemptsMade > 0) {
			try {
				await clearDurableEvents(data.investigationId);
			} catch (e) {
				logger.error("Failed to clear stale durable events on retry", e);
			}
		}

		// 1. runId == the investigation id.
		const runId = data.investigationId;

		// 2. Resolve engine inputs (shell-first; BYO-key from LLM settings).
		const built = await buildRequest(data, runId);
		sandbox = built.sandbox;
		const resolved = resolveInvestigation(built.request);

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
			apiBaseUrl: workerConfig.PRISMALENS_WORKER_API_URL,
			internalSecret: process.env.PRISMALENS_INTERNAL_SECRET,
		});
		const outcome = await conductRun(
			{
				context: resolved.context,
				harness: resolved.harness,
				synth: resolved.synth,
				fidelity: resolved.fidelity,
				runId,
				signal: abortController.signal,
			},
			{ sink, store },
		);
		// Terminal sentinel for the API relay.
		await redisPublisher.publish(channel, JSON.stringify(["__done__", {}]));

		// 4a-cancel. Cancelled by request (a Redis cancel message flipped the signal):
		// conductRun left the store untouched, so the worker owns the terminal write —
		// persist status "cancelled" + a timeline entry, then RETURN a cancelled result.
		// Never throw: a throw would let BullMQ retry a user-cancelled run.
		if (outcome.failureKind === "cancelled") {
			logger.info(`Job ${job.id} cancelled`);
			await persistCancelled(data);
			return cancelledResult(data);
		}

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
	} finally {
		// Tear down the per-job cancel subscription (CANCEL slice) — always, so a leaked
		// subscriber connection cannot outlive the job.
		try {
			cancelSubscriber.removeAllListeners();
			await cancelSubscriber.quit();
		} catch (e) {
			logger.error("Failed to close cancel subscriber", e);
		}
		if (sandbox) {
			try {
				await sandbox.destroy();
			} catch (e) {
				logger.error("Failed to destroy sandbox boundary", e);
			}
		}
	}
}

/**
 * Persist the terminal "cancelled" record (CANCEL slice, ADR-0018). conductRun leaves
 * the store untouched on cancel (it has no cancel verb), so the worker writes the status
 * + a timeline entry directly. Reuses the `investigation_completed` timeline type (no
 * dedicated cancelled type in the contract) with a distinguishing title.
 */
async function persistCancelled(data: InvestigationJobData): Promise<void> {
	await api.investigations.updateStatus({
		id: data.investigationId,
		status: "cancelled",
		error: "Investigation cancelled",
	});
	await api.timeline.create({
		incidentId: data.incidentId,
		type: "investigation_completed",
		title: "Investigation cancelled",
		description: "The investigation was cancelled before it completed.",
		source: "ai_worker",
		metadata: { investigationId: data.investigationId },
	});
}

/** A cancelled job result — returned (not thrown) so BullMQ marks the job done, no retry. */
function cancelledResult(data: InvestigationJobData): InvestigationResult {
	return {
		success: false,
		investigationId: data.investigationId,
		incidentId: data.incidentId,
		findings: {},
		recommendations: [],
		agentExecutions: [],
		error: "Investigation cancelled",
		errorType: "cancelled",
	};
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
 * Parse the `PRISMALENS_SANDBOX` knob (ADR-0020) into a {@link SandboxMode}. Defaults to
 * `process` — the cooperative floor — TODAY; flipping the server default to an
 * enforced-mandatory boundary (`e2b`) is Phase D packaging, not this slice. An unknown
 * value fails LOUDLY rather than silently degrading to the floor.
 */
export function parseSandboxMode(raw: string | undefined): SandboxMode {
	const value = raw ?? "process";
	if ((SANDBOX_MODES as readonly string[]).includes(value)) {
		return value as SandboxMode;
	}
	throw new Error(
		`Invalid PRISMALENS_SANDBOX="${raw}" — expected one of ${SANDBOX_MODES.join("|")}.`,
	);
}

/**
 * Mirror the CLI's sandbox guard (cli/src/cli/investigate.ts): only ACP-transport
 * harnesses are spawned as a child the engine can place inside a boundary — the Agent
 * SDK / subprocess harnesses run their own way — so a NON-`process` sandbox request for a
 * non-ACP harness must FAIL THE JOB FAST with an actionable message, never silently
 * record an enforcement that did not apply (ADR-0017 honest fidelity). Returns whether
 * the harness takes a sandbox, so the caller resolves one only when it will be consumed.
 */
export function harnessTakesSandbox(
	harness: HarnessId,
	mode: SandboxMode,
): boolean {
	const takesSandbox = HARNESS_REGISTRY[harness]?.transport === "acp";
	if (!takesSandbox && mode !== "process") {
		throw new Error(
			`Harness "${harness}" cannot run inside a sandbox yet (it is not spawned as ` +
				`a child process). Set PRISMALENS_SANDBOX=process or use an ACP harness ` +
				`(deepagents).`,
		);
	}
	return takesSandbox;
}

/**
 * The egress allowlist for an enforced worker sandbox (ADR-0020 "allowlist, not closed,
 * not open"): the hosts the harness legitimately reaches — the active LLM provider's
 * `allowedHosts` (config/llm) PLUS the telemetry + app surfaces (INVESTIGATION_DEFAULTS)
 * and any explicitly-configured extra endpoint (the resolved synth base URL for
 * ollama/custom). A `null` provider allowlist (`custom`) or an unparseable URL adds no
 * host — an unset source grants no egress rather than opening a hole. The `process`
 * floor ignores this; only the enforced providers (srt/e2b) consume it.
 */
export function deriveWorkerAllowedHosts(
	provider: LLMProviderId,
	extraUrls: string[] = [],
): string[] {
	const hosts = new Set<string>();
	const providerHosts = LLM_PROVIDERS[provider].allowedHosts;
	if (providerHosts) for (const host of providerHosts) hosts.add(host);
	const urls = [
		INVESTIGATION_DEFAULTS.telemetry.prometheusUrl,
		INVESTIGATION_DEFAULTS.telemetry.alertmanagerUrl,
		INVESTIGATION_DEFAULTS.telemetry.apiUrl,
		...extraUrls,
	];
	for (const url of urls) {
		if (!url) continue;
		try {
			hosts.add(new URL(url).hostname);
		} catch {
			// not a parseable URL — skip; no egress hole from a malformed endpoint
		}
	}
	return [...hosts];
}

/**
 * Build the engine investigation request from the job + LLM settings.
 * Shell-first (ADR-0005): telemetry + cwd from INVESTIGATION_DEFAULTS/env (Phase A
 * stopgap); connectors are Phase D. BYO-key (ADR-0006) from the LLM settings.
 */
async function buildRequest(
	data: InvestigationJobData,
	_runId: string,
): Promise<{ request: InvestigationRequest; sandbox?: Sandbox }> {
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

	// Isolation boundary (ADR-0020 B.1.3): the PRISMALENS_SANDBOX knob selects it; the
	// server default is still `process` (the enforced-mandatory flip is Phase D
	// packaging). Guard first (mirror the CLI): a non-`process` request for a non-ACP
	// harness fails the job fast; then resolve an enforced boundary only for the ACP
	// harness, with an allowlist derived from the LLM + telemetry hosts. The resolved
	// sandbox is CALLER-OWNED — processJobInternal destroys it after the run.
	const sandboxMode = parseSandboxMode(process.env.PRISMALENS_SANDBOX);
	const takesSandbox = harnessTakesSandbox(harness as HarnessId, sandboxMode);
	let sandbox: Sandbox | undefined;
	if (takesSandbox) {
		const allowedDomains = deriveWorkerAllowedHosts(
			synthProvider,
			synthIsOpenAiCompat ? [baseURL] : [],
		);
		sandbox = resolveSandbox(sandboxMode, { allowedDomains }).sandbox;
	}

	return {
		request: {
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
			// Resource limits (ADR-0020): unattended server runs get a wall-clock cap so a
			// wedged harness cannot pin a worker slot forever. Memory/cpu are left unset —
			// the worker's default `process` floor cannot enforce them, and claiming a cap
			// it does not apply would be dishonest (they arrive with the enforced cloud
			// provider, B.1.3). Best-effort per provider.
			limits: { wallClockMs: INVESTIGATION_DEFAULTS.harnessWallClockMs },
			...(sandbox ? { sandbox, requestedSandbox: sandboxMode } : {}),
		},
		sandbox,
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
