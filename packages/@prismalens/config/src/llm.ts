/**
 * @prismalens/config/llm
 *
 * Static LLM provider metadata and schemas.
 * This module contains NO environment-dependent code - safe for all contexts.
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
	type LLMProviderId,
	// Zod schemas
	llmProviderIdSchema,
	commonLLMConfigSchema,
	type CommonLLMConfig,
	llmConfigSchema,
	type LLMConfig,
	// Provider-specific schemas
	anthropicConfigSchema,
	googleConfigSchema,
	groqConfigSchema,
	ollamaConfigSchema,
	openaiConfigSchema,
	openrouterConfigSchema,
} from "./schemas/llm.js";
