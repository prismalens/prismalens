/**
 * LLM Factory
 *
 * Creates LLM instances using LangChain's own types directly.
 * Auto-resolves API keys from process.env if not explicitly provided.
 *
 * Includes structured error handling and logging for visibility.
 *
 * @example
 * ```typescript
 * // Ollama (local)
 * const llm = createLLM({
 *   provider: "ollama",
 *   model: "qwen3:14b",
 *   baseUrl: "http://localhost:11434",
 *   numCtx: 32768,
 * });
 *
 * // Anthropic
 * const llm = createLLM({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   temperature: 0.1,
 * });
 * ```
 */

import { Logger } from "@prismalens/logger";
import { getApiKeyEnvVar, type LLMProviderId } from "@prismalens/config/llm";
import { ChatAnthropic, type ChatAnthropicInput } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLMError, LLMErrorCode, parseLLMError } from "./errors.js";
import {
	ChatGoogleGenerativeAI,
	type GoogleGenerativeAIChatInput,
} from "@langchain/google-genai";
import { ChatGroq, type ChatGroqInput } from "@langchain/groq";
import { ChatOllama, type ChatOllamaInput } from "@langchain/ollama";
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";

const logger = new Logger({ context: "LLMFactory" });

// =============================================================================
// PROVIDER CONFIG TYPES
// =============================================================================

/**
 * Ollama provider config using LangChain's ChatOllamaInput
 */
export type OllamaProviderConfig = {
	provider: "ollama";
} & ChatOllamaInput;

/**
 * Anthropic provider config using LangChain's ChatAnthropicInput
 */
export type AnthropicProviderConfig = {
	provider: "anthropic";
} & ChatAnthropicInput;

/**
 * OpenAI provider config using LangChain's ChatOpenAIFields
 */
export type OpenAIProviderConfig = {
	provider: "openai";
} & ChatOpenAIFields;

/**
 * Google provider config using LangChain's GoogleGenerativeAIChatInput
 */
export type GoogleProviderConfig = {
	provider: "google";
} & GoogleGenerativeAIChatInput;

/**
 * Groq provider config using LangChain's ChatGroqInput
 */
export type GroqProviderConfig = {
	provider: "groq";
} & ChatGroqInput;

/**
 * OpenRouter provider config (uses OpenAI-compatible API)
 */
export type OpenRouterProviderConfig = {
	provider: "openrouter";
} & ChatOpenAIFields;

/**
 * NVIDIA provider config (uses OpenAI-compatible API)
 */
export type NvidiaProviderConfig = {
	provider: "nvidia";
} & ChatOpenAIFields;

/**
 * Discriminated union of all provider configs.
 * Each provider uses LangChain's own input types - no custom interfaces.
 */
export type LLMProviderConfig =
	| OllamaProviderConfig
	| AnthropicProviderConfig
	| OpenAIProviderConfig
	| GoogleProviderConfig
	| GroqProviderConfig
	| OpenRouterProviderConfig
	| NvidiaProviderConfig;

// =============================================================================
// PER-AGENT CONFIGURATION OVERRIDE SYSTEM
// =============================================================================

/**
 * Agent names that support LLM configuration overrides.
 * NOTE: This is a legacy type for LLM override configuration.
 * For the canonical agent names, see graph/metadata.ts
 */
export type LLMAgentName =
	| "commander"
	| "gatherer"
	| "detective"
	| "surgeon"
	| "adversary";

/** @deprecated Use LLMAgentName instead */
export type AgentName = LLMAgentName;

/**
 * Per-agent LLM override. Can override any LLMProviderConfig field.
 * If provider is not specified, inherits from base config.
 *
 * @example
 * ```typescript
 * // Override just temperature for detective
 * const detectiveOverride: AgentLLMOverride = {
 *   temperature: 0.3,
 * };
 *
 * // Override model for gatherer (faster model)
 * const gathererOverride: AgentLLMOverride = {
 *   model: "claude-3-5-haiku-20241022",
 *   temperature: 0,
 * };
 *
 * // Use completely different provider for surgeon
 * const surgeonOverride: AgentLLMOverride = {
 *   provider: "ollama",
 *   model: "qwen3:14b",
 *   baseUrl: "http://localhost:11434",
 * };
 * ```
 */
export type AgentLLMOverride = Partial<LLMProviderConfig>;

/**
 * Complete LLM configuration with optional per-agent overrides.
 *
 * @example
 * ```typescript
 * // Simple: Same config for all agents
 * const simpleConfig: LLMConfigWithOverrides = {
 *   base: {
 *     provider: "ollama",
 *     model: "qwen3:14b",
 *     baseUrl: "http://localhost:11434",
 *   }
 * };
 *
 * // Advanced: Different models/settings per agent
 * const advancedConfig: LLMConfigWithOverrides = {
 *   base: {
 *     provider: "anthropic",
 *     model: "claude-sonnet-4-20250514",
 *     apiKey: process.env.ANTHROPIC_API_KEY,
 *     temperature: 0.1,
 *   },
 *   agentOverrides: {
 *     gatherer: { model: "claude-3-5-haiku-20241022", temperature: 0 },
 *     detective: { temperature: 0.3 },
 *     surgeon: { provider: "ollama", model: "qwen3:14b", baseUrl: "http://localhost:11434" },
 *   }
 * };
 * ```
 */
export interface LLMConfigWithOverrides {
	/** Base configuration used for all agents */
	base: LLMProviderConfig;
	/** Optional per-agent overrides */
	agentOverrides?: Partial<Record<AgentName, AgentLLMOverride>>;
}

/**
 * Resolve the final LLM config for a specific agent.
 * Merges base config with agent-specific overrides.
 *
 * @param config - Configuration with base and optional overrides
 * @param agentName - Name of the agent to resolve config for
 * @returns Merged LLMProviderConfig for the agent
 *
 * @example
 * ```typescript
 * const config: LLMConfigWithOverrides = {
 *   base: { provider: "anthropic", model: "claude-sonnet-4", temperature: 0.1 },
 *   agentOverrides: {
 *     detective: { temperature: 0.3 },
 *   }
 * };
 *
 * // Returns base config (temp 0.1)
 * const commanderConfig = resolveAgentConfig(config, "commander");
 *
 * // Returns merged config (temp 0.3)
 * const detectiveConfig = resolveAgentConfig(config, "detective");
 * ```
 */
export function resolveAgentConfig(
	config: LLMConfigWithOverrides,
	agentName: AgentName,
): LLMProviderConfig {
	const override = config.agentOverrides?.[agentName];
	if (!override) {
		return config.base;
	}

	// Merge override into base (override wins)
	return {
		...config.base,
		...override,
	} as LLMProviderConfig;
}

/**
 * Wrap a simple LLMProviderConfig into LLMConfigWithOverrides.
 * Use this for backward compatibility or when no overrides are needed.
 *
 * @param config - Simple provider config
 * @returns Config wrapped with base field
 *
 * @example
 * ```typescript
 * const simpleConfig = wrapConfig({
 *   provider: "ollama",
 *   model: "qwen3:14b",
 *   baseUrl: "http://localhost:11434",
 * });
 * // Returns: { base: { provider: "ollama", ... } }
 * ```
 */
export function wrapConfig(config: LLMProviderConfig): LLMConfigWithOverrides {
	return { base: config };
}

/**
 * Type guard to check if a config is already in LLMConfigWithOverrides format.
 * Useful for handling both old (LLMProviderConfig) and new (LLMConfigWithOverrides) formats.
 */
export function isConfigWithOverrides(
	config: LLMProviderConfig | LLMConfigWithOverrides,
): config is LLMConfigWithOverrides {
	return "base" in config && typeof config.base === "object";
}

/**
 * Normalize config to LLMConfigWithOverrides format.
 * Handles both old LLMProviderConfig and new LLMConfigWithOverrides inputs.
 *
 * @param config - Config in either format
 * @returns Config in LLMConfigWithOverrides format
 */
export function normalizeConfig(
	config: LLMProviderConfig | LLMConfigWithOverrides,
): LLMConfigWithOverrides {
	if (isConfigWithOverrides(config)) {
		return config;
	}
	return wrapConfig(config);
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Creates an LLM instance from a provider config.
 *
 * Uses LangChain types directly.
 * Auto-resolves API keys from process.env via getApiKeyEnvVar() if not explicitly provided.
 *
 * @param config - Provider-specific configuration
 * @returns LangChain BaseChatModel instance
 * @throws LLMError if provider is not supported or creation fails
 *
 * @example
 * ```typescript
 * // Ollama with specific options
 * const llm = createLLM({
 *   provider: "ollama",
 *   model: "qwen3:14b",
 *   baseUrl: "http://localhost:11434",
 *   numCtx: 32768,
 *   numGpu: 999,
 *   temperature: 0,
 * });
 *
 * // Anthropic with API key from env
 * const llm = createLLM({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   temperature: 0.1,
 *   maxTokens: 4096,
 * });
 * ```
 */
export function createLLM(config: LLMProviderConfig): BaseChatModel {
	// Strip provider field and pass rest to LangChain constructor
	const { provider, ...initialRestConfig } = config;
	let restConfig = initialRestConfig;

	// Auto-resolve API key from process.env if not explicitly provided
	const envVar = getApiKeyEnvVar(provider as LLMProviderId);
	const existingKey = (restConfig as { apiKey?: string }).apiKey;
	if (!existingKey && envVar) {
		const envKey = process.env[envVar];
		if (envKey) {
			restConfig = { ...restConfig, apiKey: envKey } as typeof restConfig;
		}
	}

	// Extract model name for logging (different field names per provider)
	const model =
		(restConfig as { model?: string }).model ||
		(restConfig as { modelName?: string }).modelName ||
		"unknown";

	logger.info("Creating LLM instance", { provider, model });

	try {
		let llm: BaseChatModel;

		switch (provider) {
			case "ollama": {
				const ollamaConfig = restConfig as ChatOllamaInput;
				llm = new ChatOllama(ollamaConfig);
				break;
			}

			case "anthropic": {
				const anthropicConfig = restConfig as ChatAnthropicInput;
				llm = new ChatAnthropic(anthropicConfig);
				break;
			}

			case "openai": {
				const openaiConfig = restConfig as ChatOpenAIFields;
				llm = new ChatOpenAI(openaiConfig);
				break;
			}

			case "google": {
				const googleConfig = restConfig as GoogleGenerativeAIChatInput;
				llm = new ChatGoogleGenerativeAI(googleConfig);
				break;
			}

			case "groq": {
				const groqConfig = restConfig as ChatGroqInput;
				llm = new ChatGroq(groqConfig);
				break;
			}

			case "openrouter": {
				const openRouterConfig = restConfig as ChatOpenAIFields;
				llm = new ChatOpenAI({
					...openRouterConfig,
					configuration: {
						...openRouterConfig.configuration,
						baseURL: "https://openrouter.ai/api/v1",
						defaultHeaders: {
							"HTTP-Referer": "https://prismalens.dev",
							"X-Title": "PrismaLens",
						},
					},
				});
				break;
			}

			case "nvidia": {
				const nvidiaConfig = restConfig as ChatOpenAIFields;
				llm = new ChatOpenAI({
					...nvidiaConfig,
					maxRetries: 5, // Handle 40 req/min rate limit with exponential backoff
					configuration: {
						...nvidiaConfig.configuration,
						baseURL: "https://integrate.api.nvidia.com/v1",
					},
				});
				break;
			}

			default: {
				// TypeScript exhaustiveness check
				const exhaustiveCheck: never = provider;
				throw new LLMError(
					`Unsupported LLM provider: ${exhaustiveCheck}`,
					String(exhaustiveCheck),
					model,
					LLMErrorCode.UNKNOWN,
					false,
				);
			}
		}

		logger.debug("LLM instance created successfully", { provider, model });
		return llm;
	} catch (error) {
		// If already an LLMError, re-throw
		if (error instanceof LLMError) {
			throw error;
		}

		// Parse and wrap the error
		const llmError = parseLLMError(error, provider, model);

		logger.error("Failed to create LLM", {
			provider,
			model,
			errorCode: llmError.code,
			retryable: llmError.retryable,
			message: llmError.message,
		});

		throw llmError;
	}
}

// =============================================================================
// AGENT-SPECIFIC FACTORY
// =============================================================================

/**
 * Create an LLM instance for a specific agent node.
 *
 * Resolves provider/model from per-agent env vars first, then global env vars,
 * then defaults. API keys are resolved by `createLLM()` from process.env.
 *
 * Env var resolution order:
 * 1. `PRISMALENS_DETECTIVE_PROVIDER` / `PRISMALENS_DETECTIVE_MODEL` (per-agent)
 * 2. `PRISMALENS_LLM_PROVIDER` / `PRISMALENS_LLM_MODEL` (global)
 * 3. Defaults: "anthropic" / "claude-sonnet-4-20250514"
 *
 * @param agentName - Agent role (commander, gatherer, detective, surgeon, adversary)
 * @param options - Additional LLM options (temperature, etc.)
 * @returns LangChain BaseChatModel instance
 *
 * @example
 * ```typescript
 * const llm = createAgentLLM("detective", { temperature: 0.1 });
 * const llm = createAgentLLM("gatherer"); // uses default temperature
 * ```
 */
export function createAgentLLM(
	agentName: LLMAgentName,
	options: { temperature?: number } = {},
): BaseChatModel {
	const agentUpper = agentName.toUpperCase();

	const provider = (
		process.env[`PRISMALENS_${agentUpper}_PROVIDER`] ||
		process.env.PRISMALENS_LLM_PROVIDER ||
		"anthropic"
	) as LLMProviderConfig["provider"];

	const model =
		process.env[`PRISMALENS_${agentUpper}_MODEL`] ||
		process.env.PRISMALENS_LLM_MODEL ||
		"claude-sonnet-4-20250514";

	return createLLM({ provider, model, ...options });
}

// Re-export types for convenience
export type { BaseChatModel };
export type { ChatOllamaInput } from "@langchain/ollama";
export type { ChatAnthropicInput } from "@langchain/anthropic";
export type { ChatOpenAIFields } from "@langchain/openai";
export type { GoogleGenerativeAIChatInput } from "@langchain/google-genai";
export type { ChatGroqInput } from "@langchain/groq";

// Note: AgentName, AgentLLMOverride, LLMConfigWithOverrides, resolveAgentConfig,
// wrapConfig, isConfigWithOverrides, normalizeConfig are exported above
