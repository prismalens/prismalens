// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * prismalens.config.yaml schema (ADR-0010 engine-as-CLI), adapted from the retired
 * pl orchestrator's config to the two-tier engine (ADR-0008).
 *
 * What changed vs. the old pl config:
 *  - `agent.default` enum is the harness BACKEND the supervisor rents
 *    ("deepagents" | "claude-code" | "codex"), not the old "deepagents-cli" et al.
 *  - `agent.model` is now OPTIONAL — each harness has its own default (deepagents:
 *    "openai:gpt-oss:120b"; Claude Code: the CLI/subscription default).
 *  - ADDED `telemetry` — the engine's TelemetryEndpoints (read-only surfaces the
 *    rented harness queries).
 *  - DROPPED the gatherer/analyst/verifier role taxonomy: `harness.roles` +
 *    `harness.tool_access`, the `sub_agents` role section, `investigation`, and
 *    `convergence.confidence_threshold` (ADR-0002: no numeric confidence). In the
 *    two-tier engine decompose is N=1 (one alert → one rented branch → reduce), so
 *    the role machinery is gone.
 */
import { HARNESS_IDS, PERMISSION_MODES } from "@prismalens/config/harness";
import { llmProviderIdSchema } from "@prismalens/config/llm";
import { SANDBOX_MODES } from "@prismalens/engine";
import { z } from "zod";

/**
 * The single posture dial (ADR-0017) — prismalens does not build a permission
 * policy engine; it exposes this one dial and translates it to each harness's
 * native config. Defaults to the safest posture, `read-only`.
 */
export const PermissionConfigSchema = z.object({
	mode: z.enum(PERMISSION_MODES).default("read-only"),
});

/**
 * Arbitrary harness-native passthrough (ADR-0017) — e.g. Agent SDK query options
 * for `claude-code`, or `args` (extra CLI args) for `deepagents`. Kept untyped
 * here (per-harness runners narrow it); prismalens does not validate the shape,
 * it defers to the harness.
 */
export const HarnessNativeConfigSchema = z.object({
	native: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Best-effort resource caps for the sandboxed harness run (ADR-0020: "resource
 * limits are part of the contract"). All optional with NO defaults — an unset knob
 * means "no cap", never a value that would lie about being enforced. What actually
 * takes effect is provider-dependent (the `process` floor enforces only
 * `wall_clock_ms`; `srt` adds memory/cpu when `systemd-run` is present).
 */
export const AgentLimitsConfigSchema = z.object({
	/** Wall-clock deadline (ms) — enforced by every sandbox provider. */
	wall_clock_ms: z.number().int().positive().optional(),
	/** Memory ceiling (MB) — best-effort (srt+systemd-run only). */
	memory_mb: z.number().int().positive().optional(),
	/** CPU quota (whole/fractional cores) — best-effort (srt+systemd-run only). */
	cpu_cores: z.number().positive().optional(),
});

/** Tier-2 harness backend the supervisor rents (ADR-0008). */
export const AgentConfigSchema = z.object({
	default: z.enum(HARNESS_IDS).default("claude-code"),
	/**
	 * BARE model id (e.g. "gpt-oss:120b") — the chosen harness applies its own
	 * provider prefix (ADR-0017: deepagents prepends "openai:"; Claude Code takes it
	 * bare). Also reused as the Tier-1 reduce model id. Omit to let the harness pick
	 * its own default.
	 */
	model: z.string().optional(),
	/** The posture dial (ADR-0017). Defaults to `read-only`. */
	permissions: optionalWithDefaults(PermissionConfigSchema),
	/**
	 * The isolation boundary the harness runs in (ADR-0020): `process` (the always-on
	 * cooperative floor), `srt` (enforced OS boundary), or `auto` (srt WHEN its egress
	 * bridge is healthy — the self-check, B.1.1 — else the floor; the degrade is honest,
	 * never silent). Defaults to `auto`: honest precisely BECAUSE of the self-check, which
	 * is what makes it safe to prefer the enforced boundary by default.
	 */
	sandbox: z.enum(SANDBOX_MODES).default("auto"),
	/**
	 * Best-effort resource caps for the sandboxed harness (ADR-0020). Optional; an
	 * omitted section means "no caps" (the object defaults to `{}` after parse).
	 */
	limits: optionalWithDefaults(AgentLimitsConfigSchema),
	/**
	 * Per-alert fan-out cap (ADR-0016 decision 2): the max branches the supervisor
	 * runs when a context carries multiple alerts. Optional — omitted ⇒ the engine
	 * default (3). A single-alert run always uses one branch regardless.
	 */
	max_branches: z.number().int().positive().optional(),
	max_turns: z.number().int().positive().optional(),
});

export const WorkspaceConfigSchema = z.object({
	base_dir: z.string().default("~/.prismalens"),
});

/**
 * Run-budget guardrails for `pl listen` (issue #62): non-dollar caps only.
 * `max_concurrent`/`max_per_hour` gate dispatch; `max_turns` is threaded into the
 * default harness as a per-run runaway guard (no default ⇒ the harness's own default).
 */
export const ListenCapsConfigSchema = z.object({
	/** Max investigations running at once. Default 2. */
	max_concurrent: z.number().int().positive().default(2),
	/** Max investigations started per trailing hour. Default 10. */
	max_per_hour: z.number().int().positive().default(10),
	/** Per-run turn ceiling for the default harness. Unset ⇒ the harness default. */
	max_turns: z.number().int().positive().optional(),
});

/**
 * `pl listen` webhook intake (issue #58, Phase 1 R1). `token` is REQUIRED to
 * start listening but optional here so every other command parses a config
 * without it; set it via env interpolation (`token: "${PRISMALENS_LISTEN_TOKEN}"`)
 * rather than a literal. The grouping_window_ms configures the debounce window.
 */
export const ListenConfigSchema = z.object({
	/** Local intake port (4181: clear of 9090/9093/3000/8080 defaults). 0 = ephemeral. */
	port: z.number().int().min(0).max(65535).default(4181),
	/** Shared bearer token Alertmanager presents; unset ⇒ `pl listen` refuses to start. */
	token: z.string().optional(),
	/** Max alerts waiting or running at once; default 8. */
	max_pending: z.number().int().positive().default(8),
	/** Grouping window in milliseconds to debounce alerts into one investigation. */
	grouping_window_ms: z.number().int().min(1000).max(120000).default(60000),
	/**
	 * Slack incoming-webhook URL for report delivery (issue #61). Optional — unset ⇒
	 * delivery disabled. Set via env interpolation (slack_webhook_url:
	 * "${PRISMALENS_SLACK_WEBHOOK_URL}") so the secret stays in env (ADR-0006).
	 */
	slack_webhook_url: z.string().url().optional(),
	/** Run-budget guardrails (issue #62). Always present with defaults after parse. */
	caps: optionalWithDefaults(ListenCapsConfigSchema),
});

/**
 * Read-only telemetry + app endpoints the harness may query. Mirrors the engine's
 * TelemetryEndpoints (camelCase) so a loaded config can be handed straight to
 * `InvestigateOptions.telemetry`. All optional here — resolved/overridden per run.
 */
export const TelemetryConfigSchema = z.object({
	prometheusUrl: z.string().optional(),
	alertmanagerUrl: z.string().optional(),
	apiUrl: z.string().optional(),
});

/**
 * A service in the catalog (ADR-0015). The CLI maps the matched entry into the
 * investigation context's `service` field so a single-alert run carries the affected
 * service's repo/tier/deps, not just the bare alert.
 */
export const ServiceConfigSchema = z.object({
	tier: z.string().optional(),
	/** owner/name slug or a local path the harness reads. */
	repo: z.string().optional(),
	/** Direct dependency service names (blast-radius seed). */
	depends_on: z.array(z.string()).default([]),
});

/** A read-only log-query system the harness may curl (Loki/Elasticsearch/…). */
export const LogSourceConfigSchema = z.object({
	kind: z.string().optional(),
	url: z.string().optional(),
});

/** Free-form `{ source: { key: value } }` connection hints for alert ingestion. */
export const AlertSourceConfigSchema = z.record(
	z.string(),
	z.record(z.string(), z.string()),
);

export const RepoConfigSchema = z.object({
	repo: z.string(),
	local_path: z.string().nullable().default(null),
	alert_sources: AlertSourceConfigSchema.optional(),
});

/**
 * Make a sub-section optional in YAML but always present (with defaults) after
 * parse. The transform's return is annotated `z.output<T>` so the resolved
 * `PlConfig` keeps each sub-object's precise field types (e.g. `agent.default` is
 * the harness-id union, not `any`) instead of collapsing to `any`.
 */
function optionalWithDefaults<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
	return z
		.optional(z.record(z.string(), z.unknown()))
		.transform((val): z.output<T> => schema.parse(val ?? {}));
}

export const SynthConfigSchema = z.object({
	provider: llmProviderIdSchema.optional(),
	model: z.string().optional(),
	base_url: z.string().url().optional(),
});

export const PlConfigSchema = z.object({
	$schema: z.string().optional(),
	/** Convenience single-repo default (owner/name); `repos` is the multi-repo map. */
	repo: z.string().optional(),
	repos: z
		.record(z.string(), RepoConfigSchema)
		.optional()
		.transform((val) => val ?? {}),
	/** Service catalog (ADR-0015) — keyed by service name; maps into the context. */
	services: z
		.record(z.string(), ServiceConfigSchema)
		.optional()
		.transform((val) => val ?? {}),
	/** Read-only log-query system the harness may query. */
	logs: optionalWithDefaults(LogSourceConfigSchema),
	agent: optionalWithDefaults(AgentConfigSchema),
	synth: optionalWithDefaults(SynthConfigSchema),
	workspace: optionalWithDefaults(WorkspaceConfigSchema),
	listen: optionalWithDefaults(ListenConfigSchema),
	telemetry: optionalWithDefaults(TelemetryConfigSchema),
	alert_sources: AlertSourceConfigSchema.optional().transform(
		(val) => val ?? {},
	),
	/** Per-harness native passthrough (ADR-0017), keyed by harness id. */
	harnesses: z
		.record(z.string(), HarnessNativeConfigSchema)
		.optional()
		.transform((val) => val ?? {}),
});

export type PlConfigInput = z.input<typeof PlConfigSchema>;
/** The validated, defaults-applied config consumed by the CLI commands. */
export type PlConfig = z.output<typeof PlConfigSchema>;
