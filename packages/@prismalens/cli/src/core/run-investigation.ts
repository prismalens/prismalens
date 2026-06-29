/**
 * Shared investigation input-resolution (ADR-0008/0010).
 *
 * Both `prismalens investigate` (the live file-channel command) and the JSON-RPC
 * `investigate` method need the same thing: turn a seed alert + merged config +
 * environment (BYO-key, ADR-0006) into the four inputs `investigateIncidentStream`
 * consumes — the FiringAlert, the read-only telemetry surfaces, the rented Tier-2
 * harness, and the Tier-1 reduce model. This is that resolution, factored out so
 * the two entry points stay in lockstep.
 *
 * Pure + side-effect-free: it never reads stdin, prints, or creates a session — it
 * only resolves values and THROWS on a hard input error (no alert, unknown/unbuilt
 * harness). Callers own stdin/RPC param sourcing, warnings, and persistence.
 */
import { resolve } from "node:path";
import {
	claudeCodeHarness,
	deepAgentsHarness,
	type FiringAlert,
	type HarnessRunner,
	type SynthesisModelConfig,
	type TelemetryEndpoints,
} from "@prismalens/engine";
import type { PlConfig } from "../config/schema.js";

const DEFAULT_PROMETHEUS_URL = "http://localhost:9090";
const DEFAULT_ALERTMANAGER_URL = "http://localhost:9093";
const DEFAULT_API_URL = "http://localhost:5000";
const DEFAULT_OPENAI_BASE_URL = "https://ollama.com/v1";
const DEFAULT_SYNTH_MODEL = "gpt-oss:120b";

/**
 * Cold-start safety: deepagents' first ACP `initialize` (spawn + model warm-up) can
 * comfortably exceed the 30s default, so give the harness a generous headroom.
 */
const HARNESS_INIT_TIMEOUT_MS = 120_000;

export interface ResolveInvestigationArgs {
	/** Raw alert payload (piped JSON / RPC param) coerced into a FiringAlert. */
	alert?: Record<string, unknown>;
	/** Free-text fallback → a synthesized alert when no alert payload is supplied. */
	query?: string;
	/** Repository the harness investigates (its cwd). Defaults to `process.cwd()`. */
	repo?: string;
	/** Harness backend override; else `config.agent.default`. */
	harness?: string;
}

export interface ResolvedInvestigation {
	alert: FiringAlert;
	telemetry: TelemetryEndpoints;
	harness: HarnessRunner;
	synth: SynthesisModelConfig;
	/** The harness working directory (absolute). */
	cwd: string;
	/** The resolved harness backend name (for session labelling). */
	harnessName: string;
}

/**
 * Resolve a seed alert + merged config into the inputs `investigateIncidentStream`
 * wants. Throws on a hard input error so each caller can surface it its own way
 * (the CLI as a stderr error + non-zero exit; the server as a JSON-RPC error).
 */
export function resolveInvestigation(
	args: ResolveInvestigationArgs,
	config: PlConfig,
): ResolvedInvestigation {
	// (1) Seed alert: an explicit alert payload wins, else --query/synthesized.
	let alert: FiringAlert;
	if (args.alert) {
		alert = coerceFiringAlert(args.alert);
	} else if (args.query) {
		alert = synthesizeAlert(args.query);
	} else {
		throw new Error(
			"No alert to investigate — supply a FiringAlert payload or a query.",
		);
	}

	// (2) cwd = --repo (a local repo path) else the current directory.
	const cwd = args.repo ? resolve(args.repo) : process.cwd();

	// (3) Telemetry surfaces (read-only) — config with host-local fallbacks.
	const telemetry: TelemetryEndpoints = {
		prometheusUrl: config.telemetry.prometheusUrl ?? DEFAULT_PROMETHEUS_URL,
		alertmanagerUrl:
			config.telemetry.alertmanagerUrl ?? DEFAULT_ALERTMANAGER_URL,
		apiUrl: config.telemetry.apiUrl ?? DEFAULT_API_URL,
	};

	// (4) Tier-2 harness from --harness (else agent.default).
	const harnessName = args.harness ?? config.agent.default;
	const harness = buildHarness(harnessName, cwd, config);

	// (5) Tier-1 reduce model (Vercel AI SDK, OpenAI-compatible, BYO-key).
	const synth: SynthesisModelConfig = {
		baseURL:
			process.env.OLLAMA_BASE_URL ??
			process.env.OPENAI_BASE_URL ??
			DEFAULT_OPENAI_BASE_URL,
		apiKey: process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
		model: config.agent.model ?? DEFAULT_SYNTH_MODEL,
	};

	return { alert, telemetry, harness, synth, cwd, harnessName };
}

/** Build the Tier-2 harness runner for a backend name (throws on unknown/unbuilt). */
function buildHarness(
	harnessName: string,
	cwd: string,
	config: PlConfig,
): HarnessRunner {
	switch (harnessName) {
		case "deepagents":
			return deepAgentsHarness({
				cwd,
				// Cold-start safety (ADR-0008): the first ACP handshake can be slow.
				initTimeoutMs: HARNESS_INIT_TIMEOUT_MS,
				// agent.model is a bare id here; deepagents wants a provider prefix.
				...(config.agent.model
					? { model: `openai:${config.agent.model}` }
					: {}),
				env: {
					OPENAI_API_KEY:
						process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY,
					OPENAI_BASE_URL:
						process.env.OLLAMA_BASE_URL ??
						process.env.OPENAI_BASE_URL ??
						DEFAULT_OPENAI_BASE_URL,
				},
			});
		case "claude-code":
			return claudeCodeHarness({
				cwd,
				...(config.agent.model ? { model: config.agent.model } : {}),
			});
		case "codex":
			throw new Error("The 'codex' harness is not implemented yet.");
		default:
			throw new Error(`Unknown harness: ${harnessName}`);
	}
}

// ---------------------------------------------------------------------------
// Alert coercion
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
