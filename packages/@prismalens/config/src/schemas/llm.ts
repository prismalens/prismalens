import { z } from "zod";

/**
 * LLM Provider Metadata
 *
 * Static metadata for UI display and documentation links.
 * LangChain handles actual config validation - we don't duplicate it.
 *
 * @example
 * ```typescript
 * // Get provider info for UI
 * const provider = LLM_PROVIDERS.anthropic;
 * console.log(provider.docsUrl); // Link to LangChain docs
 * console.log(provider.suggestedModels); // Model suggestions
 * ```
 */
export const LLM_PROVIDERS = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		helpUrl: "https://console.anthropic.com/settings/keys",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/anthropic",
		envVar: "ANTHROPIC_API_KEY",
		suggestedModels: [
			"claude-sonnet-4-20250514",
			"claude-3-5-haiku-20241022",
			"claude-3-opus-20240229",
		],
	},
	openai: {
		id: "openai",
		name: "OpenAI",
		helpUrl: "https://platform.openai.com/api-keys",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/openai",
		envVar: "OPENAI_API_KEY",
		suggestedModels: [
			"gpt-4o",
			"gpt-4o-mini",
			"gpt-4-turbo",
			"o1-preview",
			"o1-mini",
		],
	},
	google: {
		id: "google",
		name: "Google Gemini",
		helpUrl: "https://aistudio.google.com",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/google_generativeai",
		envVar: "GOOGLE_API_KEY",
		suggestedModels: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
	},
	ollama: {
		id: "ollama",
		name: "Ollama",
		helpUrl: "https://ollama.ai",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/ollama",
		envVar: "OLLAMA_API_KEY", // Optional - for Ollama Cloud
		baseUrlRequired: false,
		defaultBaseUrl: "http://localhost:11434",
		cloudBaseUrl: "https://ollama.com",
		suggestedModels: [
			"kimi-k2.5:cloud",
			"kimi-k2-thinking:cloud",
			"qwen3:4b",
			"qwen3:8b",
			"qwen3:14b",
			"llama3.2",
			"mistral",
		],
	},
	groq: {
		id: "groq",
		name: "Groq",
		helpUrl: "https://console.groq.com/keys",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/groq",
		envVar: "GROQ_API_KEY",
		free: true,
		suggestedModels: [
			"llama-3.3-70b-versatile",
			"llama-3.1-8b-instant",
			"mixtral-8x7b-32768",
		],
	},
	openrouter: {
		id: "openrouter",
		name: "OpenRouter",
		helpUrl: "https://openrouter.ai/keys",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/openai", // Uses OpenAI-compatible API
		envVar: "OPENROUTER_API_KEY",
		free: true,
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		suggestedModels: [
			"meta-llama/llama-3.3-70b-instruct:free",
			"google/gemini-2.0-flash-exp:free",
			"mistralai/mistral-small-3.1-24b-instruct:free",
		],
	},
	nvidia: {
		id: "nvidia",
		name: "NVIDIA NIM",
		helpUrl: "https://build.nvidia.com",
		docsUrl: "https://js.langchain.com/docs/integrations/chat/openai", // Uses OpenAI-compatible API
		envVar: "NVIDIA_API_KEY",
		free: true, // 40 req/min free tier
		defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
		// Only models with tool_call support (verified via models.dev)
		suggestedModels: [
			"z-ai/glm4.7", // tools + reasoning + 204k context
			"nvidia/llama-3.1-nemotron-70b-instruct", // tool-capable
			"moonshotai/kimi-k2.5", // tools + reasoning
		],
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
 * Zod schema for provider IDs - dynamically derived from LLM_PROVIDERS.
 * Use this for basic validation of provider selection in UI.
 */
export const llmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);

/**
 * LLM environment variables schema.
 *
 * API keys can be provided via environment variables or saved encrypted in the DB via the UI.
 * DB-stored keys take precedence and are loaded into process.env at startup.
 * Provider/model selection is stored in DB and managed via UI.
 *
 * @example
 * ```bash
 * # LLM Provider API Keys (env var fallback - DB keys take precedence)
 * ANTHROPIC_API_KEY=sk-ant-...
 * OPENAI_API_KEY=sk-...
 * GOOGLE_API_KEY=AIza...
 * GROQ_API_KEY=gsk_...
 * OPENROUTER_API_KEY=sk-or-...
 *
 * # Ollama configuration (optional)
 * PRISMALENS_OLLAMA_BASE_URL=http://localhost:11434
 * ```
 */
export const llmEnvSchema = z.object({
	// API Keys (one per provider) - Keep standard names for external services
	ANTHROPIC_API_KEY: z.string().optional().describe("Anthropic API key"),
	OPENAI_API_KEY: z.string().optional().describe("OpenAI API key"),
	GOOGLE_API_KEY: z.string().optional().describe("Google Gemini API key"),
	GROQ_API_KEY: z.string().optional().describe("Groq API key"),
	OPENROUTER_API_KEY: z.string().optional().describe("OpenRouter API key"),
	NVIDIA_API_KEY: z.string().optional().describe("NVIDIA NIM API key"),
	OLLAMA_API_KEY: z
		.string()
		.optional()
		.describe("Ollama Cloud API key (optional - for cloud mode)"),

	// Ollama base URL - internal config
	PRISMALENS_OLLAMA_BASE_URL: z
		.string()
		.default("http://localhost:11434")
		.describe("Ollama server URL"),
});

export type LLMEnvConfig = z.infer<typeof llmEnvSchema>;

/**
 * Helper to get API key environment variable name for a provider.
 *
 * API keys can come from two sources (DB-saved key takes priority):
 * 1. UI-saved encrypted key (AES-256-GCM) → loaded into process.env at startup
 * 2. Environment variable set by Docker/K8s secrets manager
 *
 * The LLM factory resolves keys from process.env automatically.
 *
 * @param providerId - The provider ID
 * @returns The environment variable name for the API key
 */
export function getApiKeyEnvVar(providerId: LLMProviderId): string | undefined {
	return LLM_PROVIDERS[providerId]?.envVar;
}

/**
 * Helper to get LangChain docs URL for a provider.
 *
 * @param providerId - The provider ID
 * @returns The LangChain documentation URL
 */
export function getDocsUrl(providerId: LLMProviderId): string {
	return LLM_PROVIDERS[providerId]?.docsUrl;
}
