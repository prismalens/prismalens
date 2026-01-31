/**
 * LLM Provider Registry
 *
 * Runtime utilities for working with LLM providers.
 * Static provider metadata lives in @prismalens/config for frontend access.
 */

import {
	getApiKeyEnvVar,
	LLM_PROVIDERS,
	type LLMProviderId,
} from "@prismalens/config/llm";

// Re-export from config for convenience
export { getApiKeyEnvVar, LLM_PROVIDERS, type LLMProviderId };

export type ProviderMeta = (typeof LLM_PROVIDERS)[LLMProviderId];

export const SUPPORTED_PROVIDERS = Object.keys(
	LLM_PROVIDERS,
) as LLMProviderId[];

/**
 * Get provider metadata by ID
 */
export function getProviderMeta(providerId: string): ProviderMeta | undefined {
	return LLM_PROVIDERS[providerId as LLMProviderId];
}

/**
 * Check if a provider requires an API key
 */
export function requiresApiKey(providerId: string): boolean {
	const meta = getProviderMeta(providerId);
	return meta?.envVar !== null;
}

/**
 * Check if a provider offers free tier
 */
export function hasFreeTier(providerId: string): boolean {
	const meta = getProviderMeta(providerId);
	if (!meta) return false;
	return "free" in meta && meta.free === true;
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(providerId: string): string | undefined {
	const meta = getProviderMeta(providerId);
	return meta?.suggestedModels?.[0];
}
