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
 * for `claude-code`, or `shellAllowList`/`sandbox`/`args` for `deepagents`. Kept
 * untyped here (per-harness runners narrow it); prismalens does not validate the
 * shape, it defers to the harness.
 */
export const HarnessNativeConfigSchema = z.object({
	native: z.record(z.string(), z.unknown()).optional(),
});

/** Tier-2 harness backend the supervisor rents (ADR-0008). */
export const AgentConfigSchema = z.object({
	default: z.enum(HARNESS_IDS).default("deepagents"),
	/**
	 * BARE model id (e.g. "gpt-oss:120b") — the chosen harness applies its own
	 * provider prefix (ADR-0017: deepagents prepends "openai:"; Claude Code takes it
	 * bare). Also reused as the Tier-1 reduce model id. Omit to let the harness pick
	 * its own default.
	 */
	model: z.string().optional(),
	timeout_ms: z.number().positive().default(1_800_000),
	/** The posture dial (ADR-0017). Defaults to `read-only`. */
	permissions: optionalWithDefaults(PermissionConfigSchema),
});

export const BudgetConfigSchema = z.object({
	tokens: z.number().positive().default(500_000),
	timeout_ms: z.number().positive().default(1_800_000),
	max_concurrent_sub_agents: z.number().int().min(1).max(10).default(3),
	max_total_sub_agents: z.number().int().min(1).max(50).default(10),
	max_retries: z.number().int().min(0).max(5).default(2),
});

export const WorkspaceConfigSchema = z.object({
	base_dir: z.string().default("~/.prismalens"),
});

export const LoggingConfigSchema = z.object({
	level: z.enum(["debug", "info", "warn", "error"]).default("info"),
	format: z.enum(["json", "text"]).default("json"),
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

/**
 * A read-only log-query system the harness may curl (Loki/Elasticsearch/…). Kept
 * DISTINCT from `logging` (below), which is the CLI's own log-output level/format —
 * a different concern that happens to share the word.
 */
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
	/** Read-only log-query system the harness may query (distinct from `logging`). */
	logs: optionalWithDefaults(LogSourceConfigSchema),
	agent: optionalWithDefaults(AgentConfigSchema),
	budget: optionalWithDefaults(BudgetConfigSchema),
	workspace: optionalWithDefaults(WorkspaceConfigSchema),
	telemetry: optionalWithDefaults(TelemetryConfigSchema),
	alert_sources: AlertSourceConfigSchema.optional().transform(
		(val) => val ?? {},
	),
	logging: optionalWithDefaults(LoggingConfigSchema),
	/** Per-harness native passthrough (ADR-0017), keyed by harness id. */
	harnesses: z
		.record(z.string(), HarnessNativeConfigSchema)
		.optional()
		.transform((val) => val ?? {}),
});

export type PlConfigInput = z.input<typeof PlConfigSchema>;
/** The validated, defaults-applied config consumed by the CLI commands. */
export type PlConfig = z.output<typeof PlConfigSchema>;
