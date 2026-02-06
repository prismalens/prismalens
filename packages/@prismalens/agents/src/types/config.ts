// =============================================================================
// INVESTIGATION CONFIG
// =============================================================================
// Runtime configuration for investigation execution.
//
// SECURITY: Credentials never enter the LangGraph execution path.
// - API keys: resolved from process.env by the LLM factory
// - Integration credentials: resolved on-demand by tool factories
// - configurable only carries: investigationId, maxIterations, priority
//
// Separation principle:
// - Config = "how to run" (limits, runtime settings)
// - State = "what to process" (incident, alerts, findings, results)
// - process.env = "with what credentials" (API keys, set by env bridge)
// =============================================================================

import type {
	LLMConfigWithOverrides,
	LLMProviderConfig,
} from "../llm/factory.js";
import type { IntegrationContext } from "./schemas/core.js";

/**
 * Runtime configuration for investigation execution.
 * Used by the executor and queue service to configure investigations.
 *
 * SECURITY: This interface is used for constructing execution context,
 * but llmConfig and integrations are NOT passed through LangGraph's
 * RunnableConfig.configurable. API keys are resolved from process.env.
 *
 * @example
 * ```typescript
 * const config: InvestigationConfig = {
 *   llmConfig: { provider: 'anthropic', model: 'claude-sonnet-4' },
 *   integrations: [{ type: 'github', connectionId: '...' }],
 *   maxIterations: 10,
 *   priority: 'high',
 * };
 * ```
 */
export interface InvestigationConfig {
	/**
	 * LLM configuration for agents.
	 * Contains provider and model selection.
	 * API keys are resolved from process.env by the LLM factory.
	 *
	 * Supports two formats:
	 * 1. Simple: `LLMProviderConfig` - Same config for all agents
	 * 2. Advanced: `LLMConfigWithOverrides` - Base config with per-agent overrides
	 */
	llmConfig: LLMProviderConfig | LLMConfigWithOverrides;

	/**
	 * Available integrations for tools (GitHub, Render, etc.).
	 * Credentials are resolved on-demand, not passed through LangGraph.
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
 * Resolver for fetching integration contexts on-demand.
 *
 * SECURITY: Passed through configurable as a class instance (like DataProvider).
 * Not serializable — credentials are encapsulated in the closure and will NOT
 * appear in LangSmith traces, checkpoints, or error handlers.
 *
 * @example
 * ```typescript
 * // In agent nodes:
 * const resolver = config?.configurable?.integrationResolver as IntegrationResolver | undefined;
 * const integrations = resolver ? await resolver.resolve() : [];
 * ```
 */
export interface IntegrationResolver {
	/**
	 * Resolve integration contexts for tool creation.
	 * @param connectionIds - Optional filter by connection IDs. If empty/undefined, returns all.
	 */
	resolve(connectionIds?: string[]): Promise<IntegrationContext[]>;
}

/**
 * Runtime metadata extracted from RunnableConfig.configurable.
 * This is the ONLY data that passes through the LangGraph execution path.
 * No credentials, no API keys, no integration secrets.
 *
 * Additionally, configurable carries non-serializable class instances
 * (set during graph.invoke() in graph.ts — NOT checkpointed or traced):
 * - `dataProvider: DataProvider` — for fetching alerts, incidents, etc.
 * - `integrationResolver: IntegrationResolver` — for resolving integration credentials on-demand
 */
export interface ConfigurableMetadata {
	investigationId?: string;
	maxIterations: number;
	priority: "low" | "normal" | "high" | "critical";
}

/**
 * Extract non-sensitive runtime metadata from RunnableConfig.configurable.
 *
 * SECURITY: This function only extracts investigationId, maxIterations, and priority.
 * No credentials are read from or expected in configurable.
 */
export function getRuntimeMetadataFromConfigurable(
	configurable: Record<string, unknown> | undefined,
): ConfigurableMetadata {
	if (!configurable) {
		return { maxIterations: 10, priority: "normal" };
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
			? (rawPriority as ConfigurableMetadata["priority"])
			: "normal";

	// investigationId
	const investigationId =
		typeof configurable.investigationId === "string"
			? configurable.investigationId
			: undefined;

	return {
		investigationId,
		maxIterations,
		priority,
	};
}

/**
 * @deprecated Use getRuntimeMetadataFromConfigurable instead.
 * This function is kept for backward compatibility during migration.
 * It now returns null since credentials are no longer in configurable.
 */
export function getInvestigationConfigFromConfigurable(
	_configurable: Record<string, unknown> | undefined,
): InvestigationConfig | null {
	// Credentials are no longer passed through configurable.
	// Agent nodes should use createLLM() directly (factory resolves from process.env).
	return null;
}

/**
 * @deprecated Use getRuntimeMetadataFromConfigurable instead.
 */
export function hasInvestigationConfig(
	_configurable: Record<string, unknown> | undefined,
): boolean {
	return false;
}
