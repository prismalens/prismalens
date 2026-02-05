// =============================================================================
// INVESTIGATION CONFIG
// =============================================================================
// Runtime configuration passed via RunnableConfig.configurable.
// These values are NOT checkpointed to PostgreSQL, preventing credential leaks.
//
// Separation principle:
// - Config = "how to run" (credentials, limits, runtime settings)
// - State = "what to process" (incident, alerts, findings, results)
// =============================================================================

import type {
	LLMConfigWithOverrides,
	LLMProviderConfig,
} from "../llm/factory.js";
import type { IntegrationContext } from "./schemas/core.js";

/**
 * Runtime configuration for investigation execution.
 * Passed via RunnableConfig.configurable, NOT stored in checkpoints.
 *
 * @example
 * ```typescript
 * const config: InvestigationConfig = {
 *   llmConfig: { provider: 'anthropic', model: 'claude-sonnet-4', apiKey: '...' },
 *   integrations: [{ type: 'github', connectionId: '...', credentials: {...}, config: {...} }],
 *   maxIterations: 10,
 *   priority: 'high',
 * };
 * ```
 */
export interface InvestigationConfig {
	/**
	 * LLM configuration for agents.
	 * Contains provider, model, and API key.
	 *
	 * Supports two formats:
	 * 1. Simple: `LLMProviderConfig` - Same config for all agents
	 * 2. Advanced: `LLMConfigWithOverrides` - Base config with per-agent overrides
	 */
	llmConfig: LLMProviderConfig | LLMConfigWithOverrides;

	/**
	 * Available integrations for tools (GitHub, Render, etc.).
	 * Contains credentials that should NOT be checkpointed.
	 */
	integrations: IntegrationContext[];

	/**
	 * Maximum allowed iterations for the investigation.
	 * @default 10
	 */
	maxIterations?: number;

	/**
	 * Priority level for the investigation.
	 * @default "normal"
	 */
	priority?: "low" | "normal" | "high" | "critical";
}

const VALID_PRIORITIES = ["low", "normal", "high", "critical"] as const;

/**
 * Type guard to check if config has required investigation config.
 * Validates structure of nested objects at runtime.
 */
export function hasInvestigationConfig(
	configurable: Record<string, unknown> | undefined,
): configurable is Record<string, unknown> & InvestigationConfig {
	if (!configurable) return false;

	// Validate llmConfig exists and has required shape
	if (
		!("llmConfig" in configurable) ||
		configurable.llmConfig === null ||
		typeof configurable.llmConfig !== "object"
	) {
		return false;
	}

	const llm = configurable.llmConfig as Record<string, unknown>;
	if (typeof llm.provider !== "string" || typeof llm.model !== "string") {
		return false;
	}

	// Validate integrations is an array
	if (!("integrations" in configurable) || !Array.isArray(configurable.integrations)) {
		return false;
	}

	return true;
}

/**
 * Extract InvestigationConfig from RunnableConfig.configurable.
 * Returns null if config is not present or incomplete.
 * Validates types at runtime instead of using unsafe `as` casts.
 */
export function getInvestigationConfigFromConfigurable(
	configurable: Record<string, unknown> | undefined,
): InvestigationConfig | null {
	if (!hasInvestigationConfig(configurable)) {
		return null;
	}

	// maxIterations validation
	const rawMaxIterations = configurable.maxIterations;
	const maxIterations =
		typeof rawMaxIterations === "number" && rawMaxIterations > 0
			? rawMaxIterations
			: 10;

	// priority validation
	const rawPriority = configurable.priority;
	const priority =
		typeof rawPriority === "string" &&
		(VALID_PRIORITIES as readonly string[]).includes(rawPriority)
			? (rawPriority as InvestigationConfig["priority"])
			: "normal";

	return {
		llmConfig: configurable.llmConfig as
			| LLMProviderConfig
			| LLMConfigWithOverrides,
		integrations: configurable.integrations as IntegrationContext[],
		maxIterations,
		priority,
	};
}
