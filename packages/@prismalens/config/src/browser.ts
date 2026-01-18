/**
 * @prismalens/config/browser
 *
 * Browser-safe exports for frontend use.
 * This module ONLY exports static data and types - no Node.js dependencies.
 *
 * @example
 * ```typescript
 * import { LLM_PROVIDERS, type LLMProviderId } from '@prismalens/config/browser';
 * ```
 */

// Re-export only the browser-safe parts from llm schema
export {
	anthropicConfigSchema,
	type CommonLLMConfig,
	// Zod schemas (zod is browser-safe)
	commonLLMConfigSchema,
	googleConfigSchema,
	groqConfigSchema,
	LLM_PROVIDERS,
	type LLMConfig,
	type LLMProviderId,
	llmConfigSchema,
	ollamaConfigSchema,
	openaiConfigSchema,
	openrouterConfigSchema,
} from "./schemas/llm.js";
