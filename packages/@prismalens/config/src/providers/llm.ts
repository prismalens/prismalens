// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * LLM Provider Metadata
 *
 * Single source of truth for all supported LLM providers. Model *catalogs* are
 * fetched live from models.dev (no hardcoded model lists); each provider carries a
 * `defaultModel` used when the user hasn't picked one (ADR-0013). Actual model
 * calls go through `@prismalens/config/model` — the Vercel AI SDK resolver.
 *
 * @example
 * ```typescript
 * const provider = LLM_PROVIDERS.anthropic;
 * console.log(provider.defaultModel); // "claude-sonnet-4-5"
 * console.log(provider.logoUrl);      // models.dev logo URL
 * ```
 */
export const LLM_PROVIDERS = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		helpUrl: "https://console.anthropic.com/settings/keys",
		defaultModel: "claude-sonnet-4-5",
		envVar: "ANTHROPIC_API_KEY",
		logoUrl: "https://models.dev/logos/anthropic.svg",
		allowedHosts: ["api.anthropic.com"] as string[],
	},
	openai: {
		id: "openai",
		name: "OpenAI",
		helpUrl: "https://platform.openai.com/api-keys",
		defaultModel: "gpt-5-mini",
		envVar: "OPENAI_API_KEY",
		logoUrl: "https://models.dev/logos/openai.svg",
		allowedHosts: ["api.openai.com"] as string[],
	},
	google: {
		id: "google",
		name: "Google Gemini",
		helpUrl: "https://aistudio.google.com",
		defaultModel: "gemini-2.5-flash",
		envVar: "GOOGLE_API_KEY",
		logoUrl: "https://models.dev/logos/google.svg",
		allowedHosts: ["generativelanguage.googleapis.com"] as string[],
	},
	ollama: {
		id: "ollama",
		name: "Ollama",
		helpUrl: "https://ollama.ai",
		defaultModel: "gpt-oss:20b",
		envVar: "OLLAMA_API_KEY", // Optional — for Ollama Cloud
		baseUrlRequired: false,
		defaultBaseUrl: "http://localhost:11434",
		cloudBaseUrl: "https://ollama.com",
		logoUrl: "https://models.dev/logos/ollama.svg",
		allowedHosts: ["localhost", "127.0.0.1", "::1", "ollama.com"] as string[],
	},
	groq: {
		id: "groq",
		name: "Groq",
		helpUrl: "https://console.groq.com/keys",
		defaultModel: "llama-3.3-70b-versatile",
		envVar: "GROQ_API_KEY",
		free: true,
		logoUrl: "https://models.dev/logos/groq.svg",
		allowedHosts: ["api.groq.com"] as string[],
	},
	custom: {
		id: "custom",
		name: "Custom (OpenAI)",
		helpUrl: "https://platform.openai.com/docs/api-reference",
		defaultModel: null,
		envVar: "CUSTOM_LLM_API_KEY",
		baseUrlRequired: true,
		defaultBaseUrl: "http://localhost:8000/v1",
		logoUrl: null,
		allowedHosts: null as string[] | null,
	},
} as const;

export type LLMProviderId = keyof typeof LLM_PROVIDERS;

/**
 * Derive provider IDs array for Zod schema.
 * This creates a tuple type required by z.enum().
 */
export const LLM_PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as [
	LLMProviderId,
	...LLMProviderId[],
];

/**
 * All credential env-var names across providers, derived from LLM_PROVIDERS.
 * Single source of truth for "which env vars can hold an LLM credential" —
 * consumed by tooling (e.g. the CLI `doctor`) instead of re-listing them.
 */
export const LLM_CREDENTIAL_ENV_VARS: readonly string[] = Object.values(
	LLM_PROVIDERS,
).map((provider) => provider.envVar);

/**
 * Zod schema for provider IDs - dynamically derived from LLM_PROVIDERS.
 * Use this for basic validation of provider selection in UI.
 */
export const llmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);

/**
 * Helper to get API key environment variable name for a provider.
 *
 * API keys can come from two sources (DB-saved key takes priority):
 * 1. UI-saved encrypted key (AES-256-GCM) -> loaded into process.env at startup
 * 2. Environment variable set by Docker/K8s secrets manager
 *
 * The LLM factory resolves keys from process.env automatically.
 *
 * @param providerId - The provider ID
 * @returns The environment variable name for the API key
 */
export function getApiKeyEnvVar(providerId: LLMProviderId): string {
	return LLM_PROVIDERS[providerId].envVar;
}

/**
 * The default model id for a provider, or `null` when the user must choose one
 * (custom endpoints have no canonical default). ADR-0013 default-model strategy:
 * an explicit choice wins; otherwise this per-provider fallback is used.
 */
export function getDefaultModel(providerId: LLMProviderId): string | null {
	return LLM_PROVIDERS[providerId].defaultModel;
}

/**
 * Get the allowed hostnames for a provider's base URL.
 *
 * Returns `null` for providers with no host restriction (e.g. "custom"),
 * meaning any hostname is accepted. Otherwise returns the allowlist array.
 *
 * @param providerId - The provider ID
 * @returns Array of allowed hostnames, or null if unrestricted
 */
export function getAllowedHosts(
	providerId: LLMProviderId,
): readonly string[] | null {
	return LLM_PROVIDERS[providerId].allowedHosts;
}
