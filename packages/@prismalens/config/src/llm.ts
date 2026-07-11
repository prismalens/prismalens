// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
	// Helper functions
	AUTO_SELECT_PROVIDER_IDS,
	getAllowedHosts,
	getApiKeyEnvVar,
	getDefaultModel,
	LLM_CREDENTIAL_ENV_VARS,
	LLM_PROVIDER_IDS,
	// Static metadata
	LLM_PROVIDERS,
	type LLMProviderId,
	// Zod schemas (for provider ID validation only)
	llmProviderIdSchema,
} from "./providers/llm.js";
