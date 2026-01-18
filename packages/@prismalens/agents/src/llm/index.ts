// =============================================================================
// LLM INDEX
// =============================================================================
// Export LLM factory, providers, and model registry.
// =============================================================================

export {
	type BaseChatModel,
	createLLM,
	createLLMFromStoredConfig,
	getAgentConfig,
	type LLMFactoryOptions,
	registerAgentConfig,
} from "./factory.js";
export {
	getAgentCompatibleModels,
	getModelById,
	getModelsForProvider,
	getModelsRegistry,
	getReasoningModels,
	type ModelMetadata,
	refreshModelsCache,
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
