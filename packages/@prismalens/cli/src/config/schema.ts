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
import { HARNESS_IDS } from "@prismalens/config/harness";
import { z } from "zod";

/** Tier-2 harness backend the supervisor rents (ADR-0008). */
export const AgentConfigSchema = z.object({
	default: z.enum(HARNESS_IDS).default("deepagents"),
	/**
	 * Provider-prefixed model id (e.g. "openai:gpt-oss:120b"). Omit to let the
	 * chosen harness pick its own default.
	 */
	model: z.string().optional(),
	timeout_ms: z.number().positive().default(1_800_000),
	permissions: z
		.enum(["default", "permissionless", "restricted"])
		.default("default"),
	shell_allow_list: z
		.array(z.string())
		.default(["gh", "amtool", "sentry-cli", "pd", "curl", "jq", "grep", "cat"]),
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
	agent: optionalWithDefaults(AgentConfigSchema),
	budget: optionalWithDefaults(BudgetConfigSchema),
	workspace: optionalWithDefaults(WorkspaceConfigSchema),
	telemetry: optionalWithDefaults(TelemetryConfigSchema),
	alert_sources: AlertSourceConfigSchema.optional().transform(
		(val) => val ?? {},
	),
	logging: optionalWithDefaults(LoggingConfigSchema),
});

export type PlConfigInput = z.input<typeof PlConfigSchema>;
/** The validated, defaults-applied config consumed by the CLI commands. */
export type PlConfig = z.output<typeof PlConfigSchema>;
