import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import {
	getConfig,
	LLM_PROVIDERS,
	type LLMConfig,
	type LLMProviderId,
} from "@prismalens/config";

// =============================================================================
// LLM FACTORY - Per-Agent Configuration Support
// =============================================================================
// This factory creates LLM instances with support for:
// - Per-agent model overrides via environment variables
// - Multiple providers (OpenAI, Anthropic, Google, Ollama)
// - Default configurations per agent type
// - Database-stored LLM config (via createLLMFromStoredConfig)
// =============================================================================

export interface LLMFactoryOptions {
	/** Agent name for per-agent config lookup (commander, cartographer, detective, surgeon) */
	agentName?: string;
	/** LLM provider override (openai, anthropic, google, ollama) */
	provider?: string;
	/** Model name override */
	modelName?: string;
	/** Temperature override */
	temperature?: number;
	/** Max tokens limit */
	maxTokens?: number;
	/** API key override */
	apiKey?: string;
	/** Max retries for API calls */
	maxRetries?: number;
	/** LangChain callbacks for tracing */
	callbacks?: any[];
}

/**
 * Agent-specific default configurations.
 * These can be overridden by environment variables (e.g., COMMANDER_MODEL)
 * or by passing options directly to createLLM().
 */
const AGENT_DEFAULT_CONFIGS: Record<string, Partial<LLMFactoryOptions>> = {
	commander: {
		// High-capability model for orchestration and planning
		temperature: 0.1,
		// Default to DeepAgents default model
	},
	cartographer: {
		// Fast model for tool-heavy context gathering
		temperature: 0,
	},
	detective: {
		// Analytical model for root cause analysis
		temperature: 0.2,
	},
	surgeon: {
		// Precise model for code generation
		temperature: 0.1,
	},
};

/**
 * Get the model name for a specific agent.
 * Priority: options.modelName > AGENT_MODEL env > provider default model
 */
function getModelForAgent(
	agentName: string | undefined,
	provider: string,
	optionsModel?: string,
): string {
	// If explicit model provided, use it
	if (optionsModel) {
		return optionsModel;
	}

	// Check for agent-specific environment variable
	if (agentName) {
		const envKey = `${agentName.toUpperCase()}_MODEL`;
		const agentModel = process.env[envKey];
		if (agentModel) {
			return agentModel;
		}
	}

	// Fall back to provider defaults from LLM_PROVIDERS
	const providerKey = provider.toLowerCase() as LLMProviderId;
	const providerMeta = LLM_PROVIDERS[providerKey];
	if (providerMeta) {
		return providerMeta.suggestedModels[0];
	}

	// Ultimate fallback
	return "gpt-4o";
}

/**
 * Detect the provider from a model name string.
 * This allows specifying full model names in per-agent env vars.
 */
function detectProviderFromModel(modelName: string): string | null {
	const lowerModel = modelName.toLowerCase();

	// OpenRouter models have org/model format or :free suffix
	if (lowerModel.includes("/") || lowerModel.includes(":free")) {
		return "openrouter";
	}

	if (
		lowerModel.includes("gpt-") ||
		lowerModel.includes("o1-") ||
		lowerModel.includes("o3-")
	) {
		return "openai";
	}
	if (lowerModel.includes("claude")) {
		return "anthropic";
	}
	if (lowerModel.includes("gemini")) {
		return "google";
	}

	// Groq-specific model patterns (fast inference models)
	if (
		lowerModel.includes("llama-3.3-70b-versatile") ||
		lowerModel.includes("llama-3.1-8b-instant") ||
		lowerModel.includes("mixtral-8x7b")
	) {
		return "groq";
	}

	// Generic llama/mistral/qwen could be ollama (local) or groq
	// Default to ollama for these generic names
	if (
		lowerModel.includes("llama") ||
		lowerModel.includes("mistral") ||
		lowerModel.includes("qwen")
	) {
		return "ollama";
	}

	return null;
}

/**
 * Creates an LLM instance with agent-specific configuration support.
 * Uses getConfig() from @prismalens/config for centralized, validated env vars.
 *
 * @example
 * // Use defaults for commander agent
 * const llm = createLLM({ agentName: 'commander' });
 *
 * @example
 * // Override with specific model
 * const llm = createLLM({
 *   agentName: 'detective',
 *   modelName: 'claude-3-5-sonnet-latest',
 *   provider: 'anthropic'
 * });
 *
 * @example
 * // Environment variable override (DETECTIVE_MODEL=claude-3-5-sonnet-latest)
 * const llm = createLLM({ agentName: 'detective' });
 */
export function createLLM(options: LLMFactoryOptions = {}): BaseChatModel {
	// Get centralized, validated config
	const config = getConfig();

	// Merge agent defaults with provided options
	const agentDefaults = options.agentName
		? AGENT_DEFAULT_CONFIGS[options.agentName] || {}
		: {};
	const mergedOptions = { ...agentDefaults, ...options };

	// Determine provider - check if agent-specific model implies a provider
	let provider = mergedOptions.provider || config.LLM_PROVIDER;

	// If agent has a specific model set via env, detect its provider
	if (options.agentName) {
		const envKey = `${options.agentName.toUpperCase()}_MODEL`;
		const agentModel = process.env[envKey];
		if (agentModel) {
			const detectedProvider = detectProviderFromModel(agentModel);
			if (detectedProvider) {
				provider = detectedProvider;
			}
		}
	}

	// Get model name with agent-specific override support
	const modelName = getModelForAgent(
		options.agentName,
		provider,
		mergedOptions.modelName,
	);

	// Get other configuration
	const temperature = mergedOptions.temperature ?? 0;
	const maxRetries = mergedOptions.maxRetries ?? 3;
	const maxTokens = mergedOptions.maxTokens;
	const callbacks = mergedOptions.callbacks;

	const baseConfig = {
		temperature,
		maxRetries,
		callbacks,
	};

	switch (provider.toLowerCase()) {
		case "openai":
			return new ChatOpenAI({
				...baseConfig,
				modelName,
				maxTokens,
				apiKey: mergedOptions.apiKey || config.OPENAI_API_KEY,
			});

		case "anthropic":
			return new ChatAnthropic({
				...baseConfig,
				modelName,
				maxTokens,
				apiKey: mergedOptions.apiKey || config.ANTHROPIC_API_KEY,
			});

		case "google":
			return new ChatGoogleGenerativeAI({
				...baseConfig,
				model: modelName,
				maxOutputTokens: maxTokens,
				apiKey: mergedOptions.apiKey || config.GOOGLE_API_KEY,
			});

		case "ollama":
			return new ChatOpenAI({
				...baseConfig,
				modelName,
				maxTokens,
				configuration: {
					baseURL: `${config.OLLAMA_BASE_URL}/v1`,
				},
			});

		case "groq":
			return new ChatGroq({
				...baseConfig,
				model: modelName,
				maxTokens,
				apiKey: mergedOptions.apiKey || config.GROQ_API_KEY,
			});

		case "openrouter":
			return new ChatOpenAI({
				...baseConfig,
				modelName,
				maxTokens,
				apiKey: mergedOptions.apiKey || config.OPENROUTER_API_KEY,
				configuration: {
					baseURL: "https://openrouter.ai/api/v1",
					defaultHeaders: {
						"HTTP-Referer": "https://prismalens.dev",
						"X-Title": "PrismaLens",
					},
				},
			});

		default:
			throw new Error(`Unsupported LLM provider: ${provider}`);
	}
}

/**
 * Register or update agent default configuration.
 * Useful for adding new agent types at runtime.
 */
export function registerAgentConfig(
	agentName: string,
	config: Partial<LLMFactoryOptions>,
): void {
	AGENT_DEFAULT_CONFIGS[agentName] = config;
}

/**
 * Get the current configuration for an agent.
 */
export function getAgentConfig(
	agentName: string,
): Partial<LLMFactoryOptions> | undefined {
	return AGENT_DEFAULT_CONFIGS[agentName];
}

/**
 * Creates LLM from stored database config.
 * DB config takes priority, then falls back to getConfig() env vars.
 *
 * @example
 * // From settings service
 * const storedConfig = await settingsService.getActiveLlmConfigInternal();
 * const llm = createLLMFromStoredConfig(storedConfig);
 */
export function createLLMFromStoredConfig(
	storedConfig: LLMConfig | null,
	agentOptions: Omit<
		LLMFactoryOptions,
		"provider" | "modelName" | "apiKey"
	> = {},
): BaseChatModel {
	if (!storedConfig) {
		// Fall back to env vars via getConfig()
		return createLLM(agentOptions);
	}

	// Build options from stored config
	const options: LLMFactoryOptions = {
		...agentOptions,
		provider: storedConfig.provider,
		modelName: storedConfig.model,
		apiKey: storedConfig.apiKey,
		temperature: storedConfig.temperature,
		maxTokens: storedConfig.maxTokens,
	};

	// Add provider-specific fields if present
	if ("topK" in storedConfig && storedConfig.topK !== undefined) {
		// topK is supported by Anthropic/Google but not in our current factory
		// We'll pass it through temperature for now (factory can be extended later)
	}

	if ("baseUrl" in storedConfig && storedConfig.baseUrl) {
		// For Ollama, we need to handle baseUrl specially
		// The factory will use OLLAMA_BASE_URL from config, but we can override via env
		// For now, temporarily set the env var (not ideal, but works)
		if (storedConfig.provider === "ollama") {
			process.env.OLLAMA_BASE_URL = storedConfig.baseUrl;
		}
	}

	return createLLM(options);
}

// Re-export types for convenience
export type { BaseChatModel };
