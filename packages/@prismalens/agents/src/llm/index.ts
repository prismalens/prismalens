// =============================================================================
// LLM INDEX
// =============================================================================
// Export LLM factory, providers, model registry, and error handling.
// =============================================================================

export {
	// Per-agent override types and utilities
	type AgentLLMOverride,
	type LLMAgentName,
	/** @deprecated Use LLMAgentName instead to avoid conflict with graph/metadata AgentName */
	type AgentName as LLMFactoryAgentName,
	isConfigWithOverrides,
	type LLMConfigWithOverrides,
	normalizeConfig,
	resolveAgentConfig,
	wrapConfig,
	// Provider config types
	type AnthropicProviderConfig,
	type BaseChatModel,
	type ChatAnthropicInput,
	type ChatGroqInput,
	type ChatOllamaInput,
	type ChatOpenAIFields,
	createAgentLLM,
	createLLM,
	type GoogleGenerativeAIChatInput,
	type GoogleProviderConfig,
	type GroqProviderConfig,
	type LLMProviderConfig,
	type OllamaProviderConfig,
	type OpenAIProviderConfig,
	type OpenRouterProviderConfig,
} from "./factory.js";
export {
	getModelsForProvider,
	getModelsRegistry,
	type ModelMetadata,
} from "./models-registry.js";
export {
	getApiKeyEnvVar,
	getDefaultModel,
	getProviderMeta,
	hasFreeTier,
	LLM_PROVIDERS,
	type LLMProviderId,
	type ProviderMeta,
	requiresApiKey,
	SUPPORTED_PROVIDERS,
} from "./providers.js";

// Error handling
export {
	LLMError,
	LLMErrorCode,
	parseLLMError,
	formatLLMError,
	isLLMError,
} from "./errors.js";

// Model capabilities validation
export {
	type AgentRequirements,
	AGENT_REQUIREMENTS,
	clearModelCapabilitiesCache,
	fetchModelCapabilities,
	getModelInfo,
	type ModelInfo,
	type ModelsDevResponse,
	type ProviderInfo,
	summarizeModelCapabilities,
	validateModelForAgent,
	validateModelOrThrow,
	type ValidationResult,
} from "./model-capabilities.js";

// Provider health checks
export {
	checkProviderHealth,
	checkProviderHealthOrThrow,
	type HealthCheckResult,
} from "./health.js";
