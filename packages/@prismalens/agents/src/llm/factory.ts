import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

// =============================================================================
// LLM FACTORY - Per-Agent Configuration Support
// =============================================================================
// This factory creates LLM instances with support for:
// - Per-agent model overrides via environment variables
// - Multiple providers (OpenAI, Anthropic, Google, Ollama)
// - Default configurations per agent type
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
function getModelForAgent(agentName: string | undefined, provider: string, optionsModel?: string): string {
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

    // Fall back to provider defaults
    switch (provider.toLowerCase()) {
        case 'openai':
            return process.env.OPENAI_MODEL_NAME || 'gpt-4o';
        case 'anthropic':
            return process.env.ANTHROPIC_MODEL_NAME || 'claude-sonnet-4-20250514';
        case 'google':
            return process.env.GOOGLE_MODEL_NAME || 'gemini-1.5-pro';
        case 'ollama':
            return process.env.OLLAMA_MODEL_NAME || 'llama3';
        default:
            return 'gpt-4o';
    }
}

/**
 * Detect the provider from a model name string.
 * This allows specifying full model names in per-agent env vars.
 */
function detectProviderFromModel(modelName: string): string | null {
    const lowerModel = modelName.toLowerCase();

    if (lowerModel.includes('gpt-') || lowerModel.includes('o1-') || lowerModel.includes('o3-')) {
        return 'openai';
    }
    if (lowerModel.includes('claude')) {
        return 'anthropic';
    }
    if (lowerModel.includes('gemini')) {
        return 'google';
    }
    if (lowerModel.includes('llama') || lowerModel.includes('mistral') || lowerModel.includes('qwen')) {
        return 'ollama';
    }

    return null;
}

/**
 * Creates an LLM instance with agent-specific configuration support.
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
    // Merge agent defaults with provided options
    const agentDefaults = options.agentName
        ? AGENT_DEFAULT_CONFIGS[options.agentName] || {}
        : {};
    const mergedOptions = { ...agentDefaults, ...options };

    // Determine provider - check if agent-specific model implies a provider
    let provider = mergedOptions.provider || process.env.LLM_PROVIDER || 'openai';

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
    const modelName = getModelForAgent(options.agentName, provider, mergedOptions.modelName);

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
        case 'openai':
            return new ChatOpenAI({
                ...baseConfig,
                modelName,
                maxTokens,
                apiKey: mergedOptions.apiKey || process.env.OPENAI_API_KEY,
            });

        case 'anthropic':
            return new ChatAnthropic({
                ...baseConfig,
                modelName,
                maxTokens,
                apiKey: mergedOptions.apiKey || process.env.ANTHROPIC_API_KEY,
            });

        case 'google':
            return new ChatGoogleGenerativeAI({
                ...baseConfig,
                model: modelName,
                maxOutputTokens: maxTokens,
                apiKey: mergedOptions.apiKey || process.env.GOOGLE_API_KEY,
            });

        case 'ollama':
            return new ChatOpenAI({
                ...baseConfig,
                modelName,
                maxTokens,
                configuration: {
                    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
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
    config: Partial<LLMFactoryOptions>
): void {
    AGENT_DEFAULT_CONFIGS[agentName] = config;
}

/**
 * Get the current configuration for an agent.
 */
export function getAgentConfig(agentName: string): Partial<LLMFactoryOptions> | undefined {
    return AGENT_DEFAULT_CONFIGS[agentName];
}

// Re-export types for convenience
export type { BaseChatModel };
