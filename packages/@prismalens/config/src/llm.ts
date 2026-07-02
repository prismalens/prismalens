/**
 * @prismalens/config/llm
 *
 * Static LLM provider metadata and helper functions.
 * This module contains NO environment-dependent code - safe for all contexts.
 *
 * LangChain handles config validation - we only provide UI metadata.
 *
 * @example
 * ```typescript
 * import { LLM_PROVIDERS, llmProviderIdSchema } from '@prismalens/config/llm';
 * ```
 */

export {
	// Static metadata
	LLM_PROVIDERS,
	LLM_PROVIDER_IDS,
	LLM_CREDENTIAL_ENV_VARS,
	type LLMProviderId,
	// Zod schemas (for provider ID validation only)
	llmProviderIdSchema,
	// Helper functions
	getApiKeyEnvVar,
	getAllowedHosts,
	getDefaultModel,
} from "./providers/llm.js";
