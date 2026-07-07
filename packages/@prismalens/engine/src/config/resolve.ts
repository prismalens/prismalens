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
import {
	HARNESS_REGISTRY,
	type HarnessId,
	type PermissionMode,
	type PermissionOutcome,
	resolvePermissionOutcome,
} from "@prismalens/config/harness";
import {
	type FiringAlert,
	type IncidentContext,
	type InvestigationContext,
	InvestigationContextSchema,
	type LogSystemContext,
	type RunFidelity,
	type ServiceContext,
	singleAlertContext,
	type TelemetryEndpoints,
} from "@prismalens/contracts";
import type { Sandbox, SandboxLimits } from "../sandbox/types.js";
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
	/**
	 * The single posture dial (ADR-0017). Absent → "read-only" (the safe default).
	 * Translated to each harness's NATIVE config by its runner; prismalens does not
	 * build a policy engine.
	 */
	permissionMode?: PermissionMode;
	/**
	 * The chosen harness's native passthrough (ADR-0017): arbitrary harness-specific
	 * config (Agent SDK query options / deepagents `args`) that the runner spreads
	 * BENEATH prismalens's posture-derived floor. NOTE: deepagents `shellAllowList`
	 * and `sandbox` are NOT accepted — the published deepagents-acp binary has no
	 * such flags (B.1 spike, 2026-07-03); they are rejected at resolve time so a
	 * requested boundary is never silently dropped. Real isolation is the Sandbox
	 * port (`--sandbox`, ADR-0020), not a native knob.
	 */
	harnessNative?: Record<string, unknown>;
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
	/**
	 * The isolation boundary the harness is spawned into (ADR-0020), resolved by the
	 * caller (`resolveSandbox`) and CALLER-OWNED — the caller destroys it after the
	 * run. Omitted ⇒ the acp-client creates + owns a `process` floor (today's default).
	 * Only the deepagents (ACP) path consumes it; the Claude Code path is unaffected.
	 */
	sandbox?: Sandbox;
	/**
	 * What the caller ASKED for (ADR-0020 honest fidelity, structured
	 * `fidelity.sandbox` field): the CLI's `--sandbox`/`agent.sandbox` mode or the
	 * worker's `PRISMALENS_SANDBOX` knob — the request `resolveSandbox` degraded
	 * (or not) into `sandbox` above. Only meaningful alongside `sandbox`; omitted
	 * defaults to `sandbox.id` (requested == actual) so a caller that never learned
	 * a separate request still gets a consistent structured field.
	 */
	requestedSandbox?: string;
	/**
	 * Best-effort resource caps for the sandboxed harness (ADR-0020): wall-clock
	 * timeout (enforced by every provider) + memory/cpu (provider/OS permitting).
	 * Threaded to the sandbox spawn via {@link AcpClientConfig}; like `sandbox`, only
	 * the ACP (deepagents) path consumes it — the Agent SDK path runs in-process.
	 */
	limits?: SandboxLimits;
	/**
	 * Per-alert fan-out cap (ADR-0016 decision 2): the max branches the supervisor
	 * runs for a multi-alert context. Optional; omitted ⇒ the engine default. The
	 * CLI wires it from `agent.max_branches`; the worker leaves it defaulted.
	 */
	maxBranches?: number;
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
	/**
	 * The HONEST enforcement fidelity this run actually applied (ADR-0017 §4),
	 * computed from (harness, mode). Threaded into the report deterministically —
	 * never LLM-authored.
	 */
	fidelity: RunFidelity;
	/**
	 * Per-alert fan-out cap (ADR-0016 decision 2), passed straight through from the
	 * request. Undefined ⇒ the engine default applies at decompose. Callers spread it
	 * onto {@link InvestigateOptions} for conductRun.
	 */
	maxBranches?: number;
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

	const mode = req.permissionMode ?? "read-only";
	const outcome: PermissionOutcome = resolvePermissionOutcome(
		req.harness as HarnessId,
		mode,
	);
	// Honest fidelity (ADR-0017): a sandbox may only be CLAIMED when the harness
	// actually consumes it. Only ACP-transport harnesses are spawned as a child the
	// engine can place inside the boundary; the Agent SDK harness runs in-process,
	// so accepting a sandbox for it would record an enforcement that never applied.
	// Fail loudly instead of silently discarding the requested boundary.
	if (
		req.sandbox &&
		HARNESS_REGISTRY[req.harness as HarnessId]?.transport !== "acp"
	) {
		throw new Error(
			`Harness "${req.harness}" cannot run inside a sandbox yet (it is not ` +
				`spawned as a child process). Drop --sandbox or use an ACP harness ` +
				`(deepagents). Sandboxing the Agent SDK harness is a later B.1 slice.`,
		);
	}
	// Honest fidelity (ADR-0017): the deepagents native passthrough once mapped
	// `shellAllowList`/`sandbox` to the `-S`/`--sandbox` read-only enforcer flags,
	// but no published deepagents-acp distribution has them (B.1 spike, 2026-07-03)
	// — they were dropped from the arg builder. Accepting them now would silently
	// discard a boundary the user asked for, so reject them and point at the real
	// enforcement axis: the Sandbox port (`--sandbox`, ADR-0020).
	const native = req.harnessNative;
	if (
		native &&
		HARNESS_REGISTRY[req.harness as HarnessId]?.transport === "acp"
	) {
		const inert = ["shellAllowList", "sandbox"].filter((k) => k in native);
		if (inert.length > 0) {
			throw new Error(
				`deepagents native config ${inert.map((k) => `"${k}"`).join(", ")} no ` +
					`longer maps to anything — the published deepagents-acp binary has no ` +
					`shell-allowlist/sandbox flags (removed in the B.1 Sandbox-port spike). ` +
					`Remove ${inert.length > 1 ? "them" : "it"} and use ` +
					`--sandbox <process|srt|e2b> for real isolation (ADR-0020).`,
			);
		}
	}
	// When the caller wired a boundary the harness consumes, name it in the
	// run-metadata mechanism alongside the harness's own permission mechanism — the
	// sandbox is a SEPARATE enforcement axis (an OS boundary the harness runs in),
	// so it augments the mechanism string rather than overriding the permission fidelity.
	const mechanism = req.sandbox
		? `${outcome.mechanism} · sandbox=${req.sandbox.id} (${req.sandbox.fidelity})`
		: outcome.mechanism;
	const fidelity: RunFidelity = {
		harness: req.harness,
		mode,
		fidelity: outcome.fidelity,
		mechanism,
		// The structured sibling of the mechanism string above (ADR-0020 B.1.1
		// follow-up) — same requested/actual/fidelity facts, machine-readable.
		// `requested` defaults to `sandbox.id` when the caller didn't separately
		// know the request, so the field is never a lie by omission.
		...(req.sandbox
			? {
					sandbox: {
						requested: req.requestedSandbox ?? req.sandbox.id,
						actual: req.sandbox.id,
						fidelity: req.sandbox.fidelity,
					},
				}
			: {}),
	};

	const harness = buildHarness(req.harness, req.cwd, {
		model: req.model,
		harnessEnv: req.harnessEnv,
		initTimeoutMs: req.initTimeoutMs,
		permissionMode: mode,
		native: req.harnessNative,
		...(req.sandbox ? { sandbox: req.sandbox } : {}),
		...(req.limits ? { limits: req.limits } : {}),
	});

	return {
		context,
		harness,
		synth: req.synth,
		cwd: req.cwd,
		harnessName: req.harness,
		fidelity,
		...(req.maxBranches !== undefined ? { maxBranches: req.maxBranches } : {}),
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
	/** The posture dial (ADR-0017), forwarded to the harness runner for translation. */
	permissionMode?: PermissionMode;
	/** The chosen harness's native passthrough (ADR-0017). */
	native?: Record<string, unknown>;
	/** The caller-owned isolation boundary (ADR-0020); deepagents (ACP) path only. */
	sandbox?: Sandbox;
	/** Best-effort resource caps (ADR-0020); deepagents (ACP) path only. */
	limits?: SandboxLimits;
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
				...(opts.native ? { native: opts.native } : {}),
				...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
				...(opts.limits ? { limits: opts.limits } : {}),
			});
		case "claude-code":
			return claudeCodeHarness({
				cwd,
				...(model ? { model } : {}),
				...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
				...(opts.native ? { native: opts.native } : {}),
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
