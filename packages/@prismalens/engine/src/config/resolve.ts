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
import type { FiringAlert } from "../supervisor/alert-source.js";
import {
	claudeCodeHarness,
	deepAgentsHarness,
	type HarnessRunner,
	type TelemetryEndpoints,
} from "../supervisor/investigate.js";
import type { SynthesisModelConfig } from "../supervisor/synthesize.js";

/**
 * A fully-resolved investigation request. Every value is final — the caller has
 * already applied config defaults, read env/vault secrets, and made `cwd` absolute.
 */
export interface InvestigationRequest {
	/** Raw alert payload (FiringAlert / webhook / Alertmanager shape). */
	alert?: Record<string, unknown>;
	/** Free-text fallback → a synthesized alert when no `alert` payload is given. */
	query?: string;
	/** Tier-2 harness backend: "deepagents" | "claude-code" | "codex". */
	harness: string;
	/** Bare model id (e.g. "gpt-oss:120b"); the harness applies its own prefixing. */
	model?: string;
	/** Absolute working dir the harness reads (shell-first source root). */
	cwd: string;
	/** Read-only telemetry surfaces (already defaulted). */
	telemetry: TelemetryEndpoints;
	/** Tier-1 reduce model — base URL + api key already resolved (injected secret). */
	synth: SynthesisModelConfig;
	/** Child-process env for the harness (BYO-key), injected by the caller. */
	harnessEnv?: Record<string, string | undefined>;
	/** ACP cold-start headroom (ms) for the first handshake. */
	initTimeoutMs?: number;
}

export interface ResolvedInvestigation {
	alert: FiringAlert;
	telemetry: TelemetryEndpoints;
	harness: HarnessRunner;
	synth: SynthesisModelConfig;
	/** The harness working directory (absolute). */
	cwd: string;
	/** The resolved harness backend name (for session/run labelling). */
	harnessName: string;
}

/**
 * Resolve a request into the inputs `investigateIncidentStream` wants. Throws on a
 * hard input error (no alert/query, unknown/unbuilt harness) so each caller can
 * surface it its own way (CLI stderr+exit; server JSON-RPC error; worker job fail).
 */
export function resolveInvestigation(
	req: InvestigationRequest,
): ResolvedInvestigation {
	let alert: FiringAlert;
	if (req.alert) {
		alert = coerceFiringAlert(req.alert);
	} else if (req.query) {
		alert = synthesizeAlert(req.query);
	} else {
		throw new Error(
			"No alert to investigate — supply a FiringAlert payload or a query.",
		);
	}

	const harness = buildHarness(req.harness, req.cwd, {
		model: req.model,
		harnessEnv: req.harnessEnv,
		initTimeoutMs: req.initTimeoutMs,
	});

	return {
		alert,
		telemetry: req.telemetry,
		harness,
		synth: req.synth,
		cwd: req.cwd,
		harnessName: req.harness,
	};
}

interface BuildHarnessOpts {
	model?: string;
	harnessEnv?: Record<string, string | undefined>;
	initTimeoutMs?: number;
}

/** Build the Tier-2 harness runner for a backend name (throws on unknown/unbuilt). */
function buildHarness(
	harnessName: string,
	cwd: string,
	opts: BuildHarnessOpts,
): HarnessRunner {
	switch (harnessName) {
		case "deepagents":
			return deepAgentsHarness({
				cwd,
				...(opts.initTimeoutMs ? { initTimeoutMs: opts.initTimeoutMs } : {}),
				// agent.model is a bare id; deepagents wants a provider prefix.
				...(opts.model ? { model: `openai:${opts.model}` } : {}),
				...(opts.harnessEnv ? { env: opts.harnessEnv } : {}),
			});
		case "claude-code":
			return claudeCodeHarness({
				cwd,
				...(opts.model ? { model: opts.model } : {}),
			});
		case "codex":
			throw new Error("The 'codex' harness is not implemented yet.");
		default:
			throw new Error(`Unknown harness: ${harnessName}`);
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
