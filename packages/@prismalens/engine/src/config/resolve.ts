/**
 * Investigation input resolution (ADR-0008/0010/0011) — the SHARED resolver every
 * runtime uses to turn a config-derived request into the inputs
 * {@link investigateIncidentStream} consumes. The CLI feeds it from
 * `pl.config.yaml` + env (BYO-key, ADR-0006); the web worker feeds it from the
 * same config shape materialised by the Settings UI + the credential vault. One
 * config, one resolver — the web app and the CLI never diverge.
 *
 * ENV-CLEAN (ADR-0011): this module reads NO `process.env`. Secrets (api key, base
 * URL, harness child env) and defaults are RESOLVED BY THE CALLER and injected via
 * {@link InvestigationRequest}, so the engine stays a pure library the standalone
 * CLI can bundle without server config. It also OWNS alert coercion + harness
 * construction (review candidate #3) so callers only name a harness + pass config.
 */
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import {
	type FiringAlert,
	type IncidentContext,
	type InvestigationContext,
	InvestigationContextSchema,
	type LogSystemContext,
	type ServiceContext,
	singleAlertContext,
	type TelemetryEndpoints,
} from "@prismalens/contracts";
import {
	claudeCodeHarness,
	deepAgentsHarness,
	type HarnessRunner,
} from "../supervisor/investigate.js";
import type { SynthesisModelConfig } from "../supervisor/synthesize.js";

/**
 * A fully-resolved investigation request. Every value is final — the caller has
 * already applied config defaults, read env/vault secrets, and made `cwd` absolute.
 *
 * The domain input is EITHER a host-assembled `context` (the app/worker path) OR a
 * single `alert`/`query` (the CLI/degenerate path) that the resolver collapses into
 * a context via {@link singleAlertContext} — normalized here so downstream sees ONE
 * shape (ADR-0015).
 */
export interface InvestigationRequest {
	/**
	 * Host-assembled context (app/worker). Takes precedence over alert/query and is
	 * re-validated against InvestigationContextSchema — the app→worker→engine trust
	 * boundary (ADR-0015 §5).
	 */
	context?: InvestigationContext;
	/** Single-alert path: raw alert payload (FiringAlert / webhook / Alertmanager shape). */
	alert?: Record<string, unknown>;
	/** Single-alert path: free-text fallback → a synthesized alert. */
	query?: string;
	/** Single-alert enrichments (CLI, from config): the matched service, repos, log system. */
	service?: ServiceContext;
	repos?: string[];
	logs?: LogSystemContext;
	incident?: IncidentContext;
	/** Tier-2 harness backend: "deepagents" | "claude-code" | "codex". */
	harness: string;
	/** Bare model id (e.g. "gpt-oss:120b"); the harness applies its own prefixing. */
	model?: string;
	/** Absolute working dir the harness reads (shell-first source root). */
	cwd: string;
	/**
	 * Read-only telemetry surfaces (already defaulted). Folded into the context on
	 * the single-alert path; ignored when `context` is supplied (it carries its own).
	 */
	telemetry?: TelemetryEndpoints;
	/** Tier-1 reduce model — base URL + api key already resolved (injected secret). */
	synth: SynthesisModelConfig;
	/** Child-process env for the harness (BYO-key), injected by the caller. */
	harnessEnv?: Record<string, string | undefined>;
	/** ACP cold-start headroom (ms) for the first handshake. */
	initTimeoutMs?: number;
}

export interface ResolvedInvestigation {
	/** The normalized, host-assembled investigation context (ADR-0015). */
	context: InvestigationContext;
	harness: HarnessRunner;
	synth: SynthesisModelConfig;
	/** The harness working directory (absolute). */
	cwd: string;
	/** The resolved harness backend name (for session/run labelling). */
	harnessName: string;
}

/**
 * Resolve a request into the inputs `investigateIncidentStream` wants. Throws on a
 * hard input error (no context/alert/query, unknown/unbuilt harness) so each caller
 * can surface it its own way (CLI stderr+exit; server JSON-RPC error; worker job fail).
 */
export function resolveInvestigation(
	req: InvestigationRequest,
): ResolvedInvestigation {
	const context = req.context
		? InvestigationContextSchema.parse(req.context)
		: singleAlertContext(resolveSeedAlert(req), requireTelemetry(req), {
				...(req.incident ? { incident: req.incident } : {}),
				...(req.service ? { service: req.service } : {}),
				...(req.repos ? { repos: req.repos } : {}),
				...(req.logs ? { logs: req.logs } : {}),
			});

	const harness = buildHarness(req.harness, req.cwd, {
		model: req.model,
		harnessEnv: req.harnessEnv,
		initTimeoutMs: req.initTimeoutMs,
	});

	return {
		context,
		harness,
		synth: req.synth,
		cwd: req.cwd,
		harnessName: req.harness,
	};
}

/** Coerce the single-alert path's seed to a FiringAlert (raw payload or free text). */
function resolveSeedAlert(req: InvestigationRequest): FiringAlert {
	if (req.alert) return coerceFiringAlert(req.alert);
	if (req.query) return synthesizeAlert(req.query);
	throw new Error(
		"No alert to investigate — supply a context, a FiringAlert payload, or a query.",
	);
}

/** The single-alert path folds telemetry into the context; it must be supplied. */
function requireTelemetry(req: InvestigationRequest): TelemetryEndpoints {
	if (!req.telemetry) {
		throw new Error(
			"Missing telemetry endpoints — required to build a single-alert context.",
		);
	}
	return req.telemetry;
}

interface BuildHarnessOpts {
	model?: string;
	harnessEnv?: Record<string, string | undefined>;
	initTimeoutMs?: number;
}

/**
 * Build the Tier-2 harness runner for a backend name (throws on unknown/unbuilt).
 * The provider prefix comes from the registry (ADR-0017) — `agent.model` is a
 * canonical-BARE id, so deepagents' `openai:` prefix is applied HERE, once, instead
 * of the field being ambiguously "already-prefixed" (the old `openai:openai:` risk).
 */
function buildHarness(
	harnessName: string,
	cwd: string,
	opts: BuildHarnessOpts,
): HarnessRunner {
	const descriptor = HARNESS_REGISTRY[harnessName as HarnessId];
	if (!descriptor) throw new Error(`Unknown harness: ${harnessName}`);
	if (!descriptor.implemented) {
		throw new Error(`The '${harnessName}' harness is not implemented yet.`);
	}

	// Apply the harness's provider prefix to the bare model id (registry-driven).
	const model =
		opts.model && descriptor.modelPrefix
			? `${descriptor.modelPrefix}${opts.model}`
			: opts.model;

	switch (harnessName) {
		case "deepagents":
			return deepAgentsHarness({
				cwd,
				...(opts.initTimeoutMs ? { initTimeoutMs: opts.initTimeoutMs } : {}),
				...(model ? { model } : {}),
				...(opts.harnessEnv ? { env: opts.harnessEnv } : {}),
			});
		case "claude-code":
			return claudeCodeHarness({
				cwd,
				...(model ? { model } : {}),
			});
		default:
			// Registry marks it implemented but no runner is wired — a programming error.
			throw new Error(`No runner wired for harness: ${harnessName}`);
	}
}

// ---------------------------------------------------------------------------
// Alert coercion (engine-owned — review candidate #3)
// ---------------------------------------------------------------------------

/** Synthesize a minimal FiringAlert from a free-text query. */
export function synthesizeAlert(query: string): FiringAlert {
	return {
		alertname: query,
		severity: "unknown",
		labels: {},
		annotations: {},
		startsAt: null,
	};
}

/**
 * Coerce a raw JSON payload (a FiringAlert, or a webhook/Alertmanager-shaped alert)
 * into a FiringAlert. Permissive: pulls alertname/severity from top-level fields,
 * falling back to `labels`.
 */
export function coerceFiringAlert(raw: Record<string, unknown>): FiringAlert {
	const labels = asStringMap(raw.labels);
	const annotations = asStringMap(raw.annotations);
	const alertname =
		(typeof raw.alertname === "string" && raw.alertname) ||
		labels.alertname ||
		"unknown";
	const severity =
		typeof raw.severity === "string"
			? raw.severity
			: typeof labels.severity === "string"
				? labels.severity
				: null;
	const startsAt = typeof raw.startsAt === "string" ? raw.startsAt : null;
	return { alertname, severity, labels, annotations, startsAt };
}

function asStringMap(x: unknown): Record<string, string> {
	if (x === null || typeof x !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(x)) {
		if (typeof v === "string") out[k] = v;
	}
	return out;
}
