// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation job processor (ADR-0008/0010/0011 — Phase A).
 *
 * Drives the two-tier engine (`@prismalens/engine`) instead of the retired
 * LangGraph `@prismalens/agents`: resolve the engine inputs from the job + LLM
 * settings (shell-first, ADR-0005 — connectors come in Phase D), then
 * `conductRun` (ADR-0018) with an IPC SINK that hands the canonical stream to the
 * host for relay (→ EventBus → SSE → UI), and a DB STORE that folds the lifecycle
 * (status/timeline/result) via `api.investigations.writeResult`.
 *
 * This module runs inside the per-run child process the host forks. It owns no
 * dispatch state: the claim, the heartbeat and the reclaim decision all live in the
 * host's JobStore.
 *
 * Phase A note: telemetry endpoints are sourced from INVESTIGATION_DEFAULTS as a
 * local-first stopgap; the full `pl.config.yaml` sourcing (materialised by the web
 * Settings UI) lands with the config-UI work. The harness cwd is NO LONGER part of
 * that stopgap — it resolves per investigation from the incident's Service →
 * `localCheckoutPath` mapping (#331), with `PRISMALENS_INVESTIGATION_CWD` demoted
 * to the unmapped escape hatch.
 */
import {
	type InvestigationCwdResolution,
	pickServiceLabel,
	resolveInvestigationCwd,
} from "@prismalens/config";
import {
	HARNESS_REGISTRY,
	type HarnessAuthRoute,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	harnessSpeaksProvider,
	resolveHarnessSelection,
	speaksOpenAiProtocol,
} from "@prismalens/config/harness-selection";
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import {
	LLM_PROVIDERS,
	type LLMProviderId,
	providerRequiresApiKey,
} from "@prismalens/config/llm";
import {
	type CanonicalEvent,
	correlatedAlertsContext,
	type FiringAlert,
	type IncidentContext,
	type InvestigationContext,
	InvestigationJobDataSchema,
	type InvestigationReport,
	type TelemetryEndpoints,
	toFiringAlert,
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
import { config as workerConfig } from "./config.js";
import {
	createDbInvestigationStore,
	createTimelineEntry,
	fetchInvestigation,
	updateInvestigationStatus,
} from "./db-investigation-store.js";
import { internalUrl } from "./internal-url.js";
import { api } from "./orpc-client.js";
import { UnrecoverableJobError } from "./protocol.js";
import type { InvestigationJobData, InvestigationResult } from "./types.js";

const logger = new Logger({ context: "InvestigationProcessor" });

/**
 * What the run needs from its host: an identity for logging, the attempt number (a
 * rerun after a reclaim must clear the previous attempt's durable events), and the
 * channels back out. Deliberately structural — the host owns the transport, this
 * module owns the run.
 */
export interface JobContext {
	id: string;
	name: string;
	/** Completed attempts before this one. 0 on a first run, ≥1 on a rerun. */
	attemptsMade: number;
	updateProgress(progress: { percent: number; message: string }): Promise<void>;
}

/** The run's outward channels: the canonical event sink and its terminal sentinel. */
export interface JobIo {
	emit(event: CanonicalEvent): void | Promise<void>;
	streamDone(): void | Promise<void>;
	/** Fires when the host requests cancellation. */
	signal: AbortSignal;
}

/**
 * Fetch LLM configuration from the API (active provider, model, api-key creds).
 * SECURITY: the api key only lives in-memory during execution.
 */
async function fetchLlmConfig(): Promise<{
	provider: string | null;
	model: string | null;
	baseUrl: string | null;
	credentials: Record<string, string>;
	harness?: "auto" | HarnessId;
}> {
	const internalSecret = process.env.PRISMALENS_INTERNAL_SECRET;
	if (!internalSecret) {
		throw new Error(
			"PRISMALENS_INTERNAL_SECRET not set — cannot fetch LLM config",
		);
	}

	const url = internalUrl(
		workerConfig.PRISMALENS_WORKER_API_URL,
		"internal/settings/llm-credentials",
	);

	const response = await fetch(url, {
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
		harness?: "auto" | HarnessId;
	}>;
}

/**
 * Clear the durable canonical event record for an investigation (ADR-0018 B.4) before a
 * RERUN — either a retry after a failure or a reclaim of an abandoned claim. Attempt 2+
 * would otherwise collide with attempt 1's rows on `(investigationId, branchId, seq)`
 * and be dropped as duplicates (P2002), leaving the record showing the FAILED attempt's
 * events. Same X-Internal-Secret pattern as the bulk-append/LLM-config fetch. Throws on
 * a missing secret or non-2xx so the caller can log it (best-effort — a clear failure
 * must not block the rerun).
 */
async function clearDurableEvents(investigationId: string): Promise<void> {
	const internalSecret = process.env.PRISMALENS_INTERNAL_SECRET;
	if (!internalSecret) {
		// No secret ⇒ the durable record was never written (poster throws on every
		// flush), so there is nothing to clear.
		return;
	}
	const url = internalUrl(
		workerConfig.PRISMALENS_WORKER_API_URL,
		`internal/investigations/${investigationId}/events/clear`,
	);
	const response = await fetch(url, {
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
 * Process one investigation job. Called once per forked child.
 */
export default async function processInvestigationJob(
	job: JobContext,
	rawData: InvestigationJobData,
	io: JobIo,
): Promise<InvestigationResult> {
	// Read the identifiers straight off the unvalidated payload for the
	// observability context. Parsing HERE would throw before the
	// failure-persisting try/catch in processJobInternal could run, so a
	// malformed payload would leave a dangling "pending" investigation row
	// (follow-up 2, issue #302). The declared type is the host's promise about
	// what it put on the `start` message, not a runtime guarantee — the read is
	// defensive on purpose.
	const unvalidated = rawData as Partial<InvestigationJobData> | undefined;
	const rawInvestigationId = unvalidated?.investigationId;
	const rawIncidentId = unvalidated?.incidentId;
	return runWithWideEvent(
		`job-${job.id}`,
		async () => processJobInternal(job, rawData, io),
		{
			context: {
				job_id: job.id,
				job_name: job.name,
				investigation_id: rawInvestigationId,
				incident_id: rawIncidentId,
			},
		},
	);
}

async function processJobInternal(
	job: JobContext,
	rawPayload: InvestigationJobData,
	io: JobIo,
): Promise<InvestigationResult> {
	// Extract raw identifiers so the catch block can persist a "failed" status
	// even when the parse itself is what throws (follow-up 2: no dangling
	// "pending" investigation rows).
	const unvalidated = rawPayload as Partial<InvestigationJobData> | undefined;
	const rawInvestigationId = unvalidated?.investigationId;
	const rawIncidentId = unvalidated?.incidentId;

	// The isolation boundary (ADR-0020) is CALLER-OWNED — the acp-client will not
	// destroy a caller-supplied sandbox (it may span branches, B.2), so the worker owns
	// its teardown in the finally below. Especially load-bearing for `e2b`: a leaked
	// remote VM keeps costing until its timeout.
	let sandbox: Sandbox | undefined;
	// Cooperative cancellation (CANCEL slice, ADR-0018): the host owns the cancel
	// channel and forwards a request as an abort on `io.signal`, which conductRun
	// threads into the engine (stop consuming the merged stream → cascade the child kill
	// + run-owned sandbox teardown). Nothing here subscribes to anything.
	const abortSignal = io.signal;
	try {
		// Schema parse is inside the try/catch so that a validation failure marks
		// the investigation row "failed" instead of leaving it dangling as "pending"
		// (follow-up 2, issue #302).
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

		// Cancelled is sticky (#537): a stalled-job retry or a job already marked
		// cancelled must not rerun. Best-effort — on an API read error the run proceeds,
		// and the API's status writers still refuse any terminal overwrite of "cancelled".
		try {
			const current = await fetchInvestigation(
				workerConfig.PRISMALENS_WORKER_API_URL,
				process.env.PRISMALENS_INTERNAL_SECRET,
				data.investigationId,
			);
			if (current?.status === "cancelled") {
				logger.info(
					`Job ${job.id} skipped — investigation ${data.investigationId} already cancelled`,
				);
				return cancelledResult(data);
			}
		} catch (e) {
			logger.warn(
				"Could not check investigation status before run — cancellation will not be honoured for this run",
				e,
			);
		}

		// RERUN (attempt 2+ — a retry, or a reclaim of an abandoned claim): the prior
		// attempt left a stale durable event record whose rows would collide with this
		// attempt's on (investigationId, branchId, seq) and be swallowed as duplicates —
		// so the record would show the FAILED attempt's events. Clear it so each attempt
		// owns a fresh record. Best-effort: a clear failure logs and proceeds (never
		// blocks the rerun).
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

		// #331: record WHICH directory this run read, on the incident timeline, before
		// the harness starts. An unmapped run is allowed but never silent — reading the
		// wrong tree produces confident garbage, and the record has to admit it.
		await recordWorkspace(data, built.checkout);

		await job.updateProgress({
			percent: 5,
			message: "Starting investigation...",
		});

		// 3. Conduct: drive the harness once through the shared primitive
		// (ADR-0018), fanning the canonical stream to the host over IPC (live/
		// ephemeral) and folding the lifecycle through the DB store (durable —
		// status/timeline/result). conductRun owns create → append → finish|fail; it
		// never throws on a failed branch (see the outer catch for unexpected
		// transport errors).
		const sink: InvestigationSink = async (event) => {
			await io.emit(event);
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
				signal: abortSignal,
			},
			{ sink, store },
		);
		// Terminal sentinel for the API relay.
		await io.streamDone();

		// 4a-cancel. Cancelled by request (the host's cancel flipped the signal):
		// conductRun left the store untouched, so this run owns the terminal write —
		// persist status "cancelled" + a timeline entry, then RETURN a cancelled result.
		// Never throw: a throw would let the host rerun a user-cancelled investigation.
		if (outcome.failureKind === "cancelled") {
			logger.info(`Job ${job.id} cancelled`);
			try {
				await persistCancelled(data);
			} catch (e) {
				// Swallow, never rethrow: the outer catch would overwrite the run as
				// "failed" and the host would rerun a user-cancelled investigation. The
				// record stays "running" until the user's next cancel click takes the
				// API's zero-receiver fallback write.
				logger.error("Failed to persist cancelled status", e);
			}
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
		// Use raw identifiers so this block can persist the failure even when the
		// schema parse itself was what threw.
		if (rawInvestigationId) {
			try {
				await updateInvestigationStatus(
					workerConfig.PRISMALENS_WORKER_API_URL,
					process.env.PRISMALENS_INTERNAL_SECRET,
					rawInvestigationId,
					{
						status: "failed",
						error: errorMessage,
					},
				);
				if (rawIncidentId) {
					await createTimelineEntry(
						workerConfig.PRISMALENS_WORKER_API_URL,
						process.env.PRISMALENS_INTERNAL_SECRET,
						{
							incidentId: rawIncidentId,
							type: "investigation_completed",
							title: "AI Investigation Failed",
							description: errorMessage,
							source: "ai_worker",
							metadata: {
								investigationId: rawInvestigationId,
								error: errorMessage,
							},
						},
					);
				}
			} catch (e) {
				logger.error(
					"Failed to update failure status — failure will not be persisted to database or timeline",
					e,
				);
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

/**
 * Write the resolved investigation workspace to the incident timeline (#331).
 *
 * Best-effort: a timeline hiccup must not fail an otherwise-good investigation,
 * but the worker log always carries the same sentence (emitted in `buildRequest`),
 * so the resolution is never unrecorded in both places at once.
 */
async function recordWorkspace(
	data: InvestigationJobData,
	checkout: InvestigationCwdResolution,
): Promise<void> {
	try {
		await createTimelineEntry(
			workerConfig.PRISMALENS_WORKER_API_URL,
			process.env.PRISMALENS_INTERNAL_SECRET,
			{
				incidentId: data.incidentId,
				type: "investigation_started",
				title: checkout.mapped
					? "Investigating the mapped local checkout"
					: "Investigating WITHOUT a mapped local checkout",
				description: checkout.note,
				source: "ai_worker",
				metadata: {
					investigationId: data.investigationId,
					cwd: checkout.cwd,
					cwdSource: checkout.source,
					mapped: checkout.mapped,
				},
			},
		);
	} catch (e) {
		logger.error("Failed to record the investigation workspace", e);
	}
}

/**
 * Persist the terminal "cancelled" record (CANCEL slice, ADR-0018). conductRun leaves
 * the store untouched on cancel (it has no cancel verb), so the worker writes the status
 * + a timeline entry directly. Reuses the `investigation_completed` timeline type (no
 * dedicated cancelled type in the contract) with a distinguishing title.
 */
async function persistCancelled(data: InvestigationJobData): Promise<void> {
	await updateInvestigationStatus(
		workerConfig.PRISMALENS_WORKER_API_URL,
		process.env.PRISMALENS_INTERNAL_SECRET,
		data.investigationId,
		{
			status: "cancelled",
			error: "Investigation cancelled",
		},
	);
	await createTimelineEntry(
		workerConfig.PRISMALENS_WORKER_API_URL,
		process.env.PRISMALENS_INTERNAL_SECRET,
		{
			incidentId: data.incidentId,
			type: "investigation_completed",
			title: "Investigation cancelled",
			description: "The investigation was cancelled before it completed.",
			source: "ai_worker",
			metadata: { investigationId: data.investigationId },
		},
	);
}

/** A cancelled job result — returned (not thrown) so the host marks the job done, no rerun. */
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

/**
 * Re-exported from `@prismalens/config/harness-selection`, which owns the
 * deepagents protocol rule now that the API needs the same answer (#518).
 */
export { speaksOpenAiProtocol };

/**
 * Assemble harness env vars scoped to the harness and auth route (ADR-0031 R7).
 * cli-session runs inject no credentials; keyless providers omit api key (#519, #525).
 */
export function buildHarnessEnv(
	harness: HarnessId,
	route: HarnessAuthRoute,
	synthProvider: LLMProviderId | null,
	apiKey: string,
	baseURL: string,
): Record<string, string> {
	if (route === "cli-session" || !synthProvider) {
		return {};
	}
	const isOpenAiCompat =
		synthProvider === "ollama" || synthProvider === "custom";
	if (harness === "deepagents" && speaksOpenAiProtocol(synthProvider)) {
		return {
			...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
			...(isOpenAiCompat && baseURL ? { OPENAI_BASE_URL: baseURL } : {}),
		};
	}
	if (harness === "claude-code" && synthProvider === "anthropic" && apiKey) {
		return {
			ANTHROPIC_API_KEY: apiKey,
		};
	}
	return {};
}

/**
 * Parse the `PRISMALENS_SANDBOX` knob (ADR-0020) into a {@link SandboxMode}. Defaults to
 * `auto` — srt when its egress bridge is healthy (the self-check, B.1.1), else the
 * cooperative process floor; the degrade is honest, never silent. Making `auto` the default
 * is safe precisely because of that self-check. Making an enforced boundary MANDATORY
 * (`e2b`, no floor fallback) is Phase D packaging, not this slice. An unknown value fails
 * LOUDLY rather than silently degrading to the floor.
 */
export function parseSandboxMode(raw: string | undefined): SandboxMode {
	const value = raw ?? "auto";
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
 * SDK / subprocess harnesses run their own way. FAIL THE JOB FAST only when the mode
 * DEMANDS an enforced boundary (`srt`/`e2b`) a non-ACP harness cannot honour (ADR-0017
 * honest fidelity — never record an enforcement that did not apply). `auto` and `process`
 * on a non-ACP harness take NO sandbox and DO NOT throw: `auto` means best-effort, and the
 * best available for an in-process harness is none — nothing is claimed, nothing is
 * dishonest. Returns whether the harness takes a sandbox, so the caller resolves one only
 * when it will be consumed.
 */
export function harnessTakesSandbox(
	harness: HarnessId,
	mode: SandboxMode,
): boolean {
	const takesSandbox = HARNESS_REGISTRY[harness]?.transport === "acp";
	const demandsEnforcedBoundary = mode === "srt" || mode === "e2b";
	if (!takesSandbox && demandsEnforcedBoundary) {
		// UnrecoverableJobError: a config contradiction cannot succeed on a rerun — fail
		// the job once instead of burning the attempt budget. The child reports it to the
		// host as `retryable: false`.
		throw new UnrecoverableJobError(
			`Harness "${harness}" cannot run inside an enforced sandbox (${mode}) yet — it ` +
				`is not spawned as a child process. Set PRISMALENS_SANDBOX=auto or process ` +
				`(no enforced boundary), or use an ACP harness (deepagents).`,
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
 * The egress SELF-CHECK target (ADR-0020 B.1.1) for the worker: the FIRST configured,
 * parseable FULL URL among the worker's own API URL and the INVESTIGATION_DEFAULTS
 * telemetry endpoints — handed to `auto` as `probeUrl` so its throwaway srt boundary curls
 * a REAL endpoint (not a fabricated `https://<host>/`). `undefined` when none parse, in
 * which case `auto` floors rather than standing up a zero-egress boundary (FIX 6).
 */
export function workerProbeUrl(): string | undefined {
	const candidates = [
		workerConfig.PRISMALENS_WORKER_API_URL,
		INVESTIGATION_DEFAULTS.telemetry.prometheusUrl,
		INVESTIGATION_DEFAULTS.telemetry.alertmanagerUrl,
		INVESTIGATION_DEFAULTS.telemetry.apiUrl,
	];
	for (const url of candidates) {
		if (!url) continue;
		try {
			return new URL(url).href;
		} catch {
			// not a parseable URL — skip; a malformed endpoint is no probe target
		}
	}
	return undefined;
}

export interface BuildRequestOpts {
	harnessAuth?: {
		homeDir?: string;
		isOnPath?: (bin: string) => boolean;
	};
}

/**
 * Build the engine investigation request from the job + LLM settings.
 * Shell-first (ADR-0005): telemetry + cwd from INVESTIGATION_DEFAULTS/env (Phase A
 * stopgap); connectors are Phase D. BYO-key (ADR-0006) from the LLM settings.
 *
 * Exported so the resolved REQUEST — not a restated constant — is what the posture
 * tests assert (the same reason `parseSandboxMode`/`harnessTakesSandbox` are exported).
 */
export async function buildRequest(
	data: InvestigationJobData,
	_runId: string,
	opts?: BuildRequestOpts,
): Promise<{
	request: InvestigationRequest;
	sandbox?: Sandbox;
	checkout: InvestigationCwdResolution;
}> {
	const llmConfig = await fetchLlmConfig();
	const synthProvider = (llmConfig?.provider as LLMProviderId | null) ?? null;
	const apiKey = Object.values(llmConfig?.credentials ?? {})[0] ?? "";

	// One predicate, shared with the API (ADR-0031, #518). The worker used to own
	// this logic inline and the API re-derived it; four defects came out of the
	// two copies disagreeing. Behaviour of record still lives here — it just lives
	// in a function both callers use.
	const selection = resolveHarnessSelection({
		provider: synthProvider,
		apiKey,
		model: llmConfig?.model ?? null,
		harness: (llmConfig?.harness ?? "auto") as "auto" | HarnessId,
		envHarness: process.env.PRISMALENS_HARNESS,
		auth: opts?.harnessAuth,
	});
	if (!selection.runnable) {
		throw new Error(selection.reason);
	}
	const harness = selection.harness;

	if (selection.route === "cli-session" && !selection.verified) {
		logger.warn(
			"Harness session is unverified (no credentials file found) — in-run auth failure may occur if not logged in via CLI",
		);
	}

	const routeLabel =
		selection.route === "cli-session" ? "signed-in session" : "api-key";
	logger.info(
		`harness: ${harness} (${selection.auto ? "auto — " : ""}${routeLabel})`,
	);

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
	const baseURL = llmConfig?.baseUrl ?? INVESTIGATION_DEFAULTS.synth.baseURL;
	// Tier-1 reduce runs on the user's chosen provider (ADR-0013 resolver); a base
	// URL is only needed for the OpenAI-compatible providers (ollama/custom).
	const synthIsOpenAiCompat =
		synthProvider === "ollama" || synthProvider === "custom";

	// Isolation boundary (ADR-0020 B.1.3): the PRISMALENS_SANDBOX knob selects it; the
	// server default is now `auto` — srt when its egress bridge is healthy (self-check,
	// B.1.1), else the process floor (the enforced-MANDATORY flip is still Phase D
	// packaging). Guard first (mirror the CLI): a non-`process` request for a non-ACP
	// harness fails the job fast; then resolve a boundary only for the ACP harness, with
	// an allowlist derived from the LLM + telemetry hosts. The resolved sandbox is
	// CALLER-OWNED — processJobInternal destroys it after the run.
	const sandboxMode = parseSandboxMode(process.env.PRISMALENS_SANDBOX);
	const takesSandbox = harnessTakesSandbox(harness, sandboxMode);
	let sandbox: Sandbox | undefined;
	if (takesSandbox) {
		const allowedDomains = deriveWorkerAllowedHosts(
			synthProvider ?? "openai",
			synthIsOpenAiCompat && baseURL ? [baseURL] : [],
		);
		// ASYNC: `auto` runs an egress self-check (B.1.1) before trusting srt for this
		// egress-needing run. Log the honest reason on a degrade (ADR-0017) so an
		// operator sees the worker fell back to the cooperative floor, never a silent
		// downgrade.
		const probeUrl = workerProbeUrl();
		const selection = await resolveSandbox(sandboxMode, {
			allowedDomains,
			...(probeUrl ? { probeUrl } : {}),
		});
		if (selection.degradeReason) {
			logger.warn(
				`Sandbox '${sandboxMode}' degraded to ${selection.actual}: ${selection.degradeReason}`,
			);
		}
		sandbox = selection.sandbox;
	}

	const context = assembleInvestigationContext(incident, data, {
		...INVESTIGATION_DEFAULTS.telemetry,
	});

	// Harness working directory — resolved PER INVESTIGATION (#331, closing #243
	// item 6 and #238's per-alert-cwd deletion gate). The incident carries its
	// Service, the Service carries `localCheckoutPath`, and that path is the
	// directory this run reads. `PRISMALENS_INVESTIGATION_CWD` survives only as
	// the unmapped escape hatch — it is no longer the primary mechanism.
	//
	// The precedence itself lives in `@prismalens/config` next to the CLI's
	// `resolveRepoPath`, so `pl listen` and the app cannot drift apart (D11).
	const mapping = await resolveServiceCheckout(incident, data);
	const checkout = resolveInvestigationCwd({
		mappedPath: mapping.localCheckoutPath,
		serviceName: mapping.serviceName,
		envOverride: process.env.PRISMALENS_INVESTIGATION_CWD,
	});
	// An unmapped run is not a failure, but it must never be silent: a run against
	// the wrong tree produces confident garbage. Log it here; processJobInternal
	// writes the same sentence to the incident timeline so the report SAYS it.
	if (checkout.mapped) {
		logger.info(checkout.note);
	} else {
		logger.warn(checkout.note);
	}

	const isSynthConfigured =
		Boolean(apiKey) ||
		(synthProvider !== null && !providerRequiresApiKey(synthProvider));

	const isModelCompatible =
		Boolean(llmConfig?.model) &&
		synthProvider !== null &&
		harnessSpeaksProvider(harness, synthProvider);

	return {
		checkout,
		request: {
			context,
			harness,
			// The single posture dial (ADR-0017): the worker is always read-only in
			// Phase A — no per-run override, no native passthrough.
			permissionMode: "read-only",
			...(isModelCompatible && llmConfig?.model
				? { model: llmConfig.model }
				: {}),
			cwd: checkout.cwd,
			synth: {
				providerId: synthProvider ?? "ollama",
				model: llmConfig?.model ?? "",
				...(apiKey ? { apiKey } : {}),
				...(synthIsOpenAiCompat && baseURL ? { baseURL } : {}),
				configured: isSynthConfigured,
			},
			harnessEnv: buildHarnessEnv(
				harness,
				selection.route,
				synthProvider,
				apiKey,
				baseURL,
			),
			initTimeoutMs: INVESTIGATION_DEFAULTS.harnessInitTimeoutMs,
			// Resource limits (ADR-0020): unattended server runs get a wall-clock cap so a
			// wedged harness cannot pin a worker slot forever. Memory/cpu are left unset —
			// the worker's default `process` floor cannot enforce them, and claiming a cap
			// it does not apply would be dishonest (they arrive with the enforced cloud
			// provider, B.1.3). Best-effort per provider.
			limits: { wallClockMs: INVESTIGATION_DEFAULTS.harnessWallClockMs },
			...(sandbox ? { sandbox, requestedSandbox: sandboxMode } : {}),
			// Owning decision: ADR-0020 (the Sandbox port — placement-scaled harness
			// isolation) — the server placement's posture is what makes this mandatory.
			// ADR-0017 is a SEPARATE decision (harness registry + honest fidelity); it
			// governs how the resulting posture is REPORTED per harness, not whether
			// isolation applies. Docs surfaces: no README or CLI --help change — this is
			// a worker-internal placement default with no user-facing flag; the hub's
			// security-and-sandbox spec carries the placement table.
			// Settings isolation is MANDATORY here, not a knob (ADR-0020): server
			// placements sandbox non-negotiably, and inheriting the user's environment is
			// appropriate only on the LOCAL placements. Without this the rented harness
			// loads the host account's `~/.claude` — settings, hooks, plugins, MCP servers
			// — and a hook there executes ON THE HOST, outside the boundary resolved
			// immediately above. Mirrors `cli/src/cli/listen.ts` (the other unattended
			// entrypoint) and `engine/eval/ab-runner.ts` (what every eval measured).
			isolateSettings: true,
		},
		sandbox,
	};
}

/**
 * Assemble the host investigation context (ADR-0015) from the incident + ALL seed
 * alerts, adopting `correlatedAlertsContext` from `@prismalens/contracts`.
 * Each alert keeps its own identity; the incident meta rides in `context.incident`.
 */
/**
 * Find the Service whose local checkout this investigation should run in (#331).
 *
 * Two sources, in order — together they are the app-side equivalent of the CLI's
 * `resolveRepoPath(alert, config)` chain (#238's per-alert-cwd deletion gate):
 *
 *  1. the incident's own Service (correlation copies `serviceId` off the alert,
 *     so this is already per-incident, not per-process);
 *  2. failing that, the firing alert's `service`/`namespace`/`job` label looked
 *     up by exact name — the same label `pickServiceLabel` reads for `pl listen`.
 *     This covers an incident that never got a `serviceId` but whose alert names
 *     a service the operator has mapped.
 *
 * Both lookups are best-effort: a lookup failure yields an UNMAPPED run that says
 * so, never a failed job.
 */
async function resolveServiceCheckout(
	incident: Record<string, unknown> | null,
	data: InvestigationJobData,
): Promise<{ serviceName?: string; localCheckoutPath?: string | null }> {
	const incidentService = incident?.service as
		| { name?: string; localCheckoutPath?: string | null }
		| null
		| undefined;
	if (incidentService?.localCheckoutPath) {
		return {
			...(incidentService.name ? { serviceName: incidentService.name } : {}),
			localCheckoutPath: incidentService.localCheckoutPath,
		};
	}

	// The incident's OWN service is authoritative when it has one — the alert label
	// is the fallback, not an override. Letting a label outrank the incident's
	// service would let an alert labelled "checkout" borrow that service's tree for
	// an incident the correlator assigned to "billing": a silent wrong-dir run of
	// exactly the kind this issue exists to stop.
	// Same alert source as `assembleInvestigationContext`: the job's seed alerts
	// first, else the incident's persisted alerts. A job dispatched without inline
	// alerts still has a service label to resolve from.
	const alerts = (
		data.alerts && data.alerts.length > 0
			? data.alerts
			: Array.isArray(incident?.alerts)
				? incident.alerts
				: []
	) as Record<string, unknown>[];
	const label = incidentService?.name ?? pickServiceLabel(alerts[0]);
	if (!label) return {};
	try {
		const { data: matches } = await api.services.list({ search: label });
		// `search` is a CONTAINS match — an exact name match is the only safe
		// mapping, or "checkout" would silently borrow "checkout-legacy"'s tree.
		const exact = matches.find((s) => s.name === label);
		return {
			serviceName: label,
			localCheckoutPath: exact?.localCheckoutPath ?? null,
		};
	} catch {
		return { serviceName: label };
	}
}

function assembleInvestigationContext(
	incident: Record<string, unknown> | null,
	data: InvestigationJobData,
	telemetry: TelemetryEndpoints,
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

	return correlatedAlertsContext(firingAlerts, telemetry, {
		incident: incident ? incidentMeta(incident) : undefined,
	});
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
