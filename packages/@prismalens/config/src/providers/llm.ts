import { z } from "zod";

/**
 * LLM Provider Metadata
 *
 * Single source of truth for all supported LLM providers.
 * Models are fetched live from models.dev — no hardcoded model lists.
 * LangChain handles actual config validation — we don't duplicate it.
 *
 * @example
 * ```typescript
 * const provider = LLM_PROVIDERS.anthropic;
 * console.log(provider.docsUrl); // Link to LangChain docs
 * console.log(provider.logoUrl); // models.dev logo URL
 * ```
 */
export const LLM_PROVIDERS = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		helpUrl: "https://console.anthropic.com/settings/keys",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/anthropic",
		envVar: "ANTHROPIC_API_KEY",
		logoUrl: "https://models.dev/logos/anthropic.svg",
		allowedHosts: ["api.anthropic.com"] as string[],
	},
	openai: {
		id: "openai",
		name: "OpenAI",
		helpUrl: "https://platform.openai.com/api-keys",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/openai",
		envVar: "OPENAI_API_KEY",
		logoUrl: "https://models.dev/logos/openai.svg",
		allowedHosts: ["api.openai.com"] as string[],
	},
	google: {
		id: "google",
		name: "Google Gemini",
		helpUrl: "https://aistudio.google.com",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/google_generativeai",
		envVar: "GOOGLE_API_KEY",
		logoUrl: "https://models.dev/logos/google.svg",
		allowedHosts: ["generativelanguage.googleapis.com"] as string[],
	},
	ollama: {
		id: "ollama",
		name: "Ollama",
		helpUrl: "https://ollama.ai",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/ollama",
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
		docsUrl: "https://js.langchain.com/docs/integrations/chat/groq",
		envVar: "GROQ_API_KEY",
		free: true,
		logoUrl: "https://models.dev/logos/groq.svg",
		allowedHosts: ["api.groq.com"] as string[],
	},
	custom: {
		id: "custom",
		name: "Custom (OpenAI)",
		helpUrl: "https://platform.openai.com/docs/api-reference",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/openai",
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
