import { z } from "zod";

/**
 * LLM Provider Metadata
 *
 * Minimal static info for each supported provider.
 * Configuration options are derived from LangChain types.
 */
export const LLM_PROVIDERS = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		helpUrl: "https://console.anthropic.com/settings/keys",
		envVar: "ANTHROPIC_API_KEY",
		// Suggested models - user can enter any valid model
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
		envVar: "GOOGLE_API_KEY",
		suggestedModels: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
	},
	ollama: {
		id: "ollama",
		name: "Ollama",
		helpUrl: "https://ollama.ai",
		envVar: "OLLAMA_API_KEY", // Optional - for Ollama Cloud
		baseUrlRequired: false, // Not required if using cloud
		defaultBaseUrl: "http://localhost:11434",
		cloudBaseUrl: "https://ollama.com",
		suggestedModels: ["llama3.2", "llama3.1", "mistral", "codellama"],
	},
	groq: {
		id: "groq",
		name: "Groq",
		helpUrl: "https://console.groq.com/keys",
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
		envVar: "OPENROUTER_API_KEY",
		free: true,
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		suggestedModels: [
			"meta-llama/llama-3.3-70b-instruct:free",
			"google/gemini-2.0-flash-exp:free",
			"mistralai/mistral-small-3.1-24b-instruct:free",
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
 * Use this instead of hardcoding provider enums.
 */
export const llmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);

/**
 * Common configuration fields derived from LangChain type interfaces.
 * These are the fields that most providers support (intersection).
 */
export const commonLLMConfigSchema = z.object({
	// Required
	model: z.string().min(1, "Model is required"),

	// Auth - provider-specific
	apiKey: z.string().optional(),
	baseUrl: z.string().url().optional(),

	// Common optional fields (from LangChain types)
	temperature: z.number().min(0).max(2).optional(),
	maxTokens: z.number().positive().optional(),
	topP: z.number().min(0).max(1).optional(),
	streaming: z.boolean().optional(),
});

/**
 * Provider-specific config extensions (from LangChain types)
 */
export const anthropicConfigSchema = commonLLMConfigSchema.extend({
	topK: z.number().positive().optional(),
	stopSequences: z.array(z.string()).optional(),
});

export const openaiConfigSchema = commonLLMConfigSchema.extend({
	frequencyPenalty: z.number().min(-2).max(2).optional(),
	presencePenalty: z.number().min(-2).max(2).optional(),
	logitBias: z.record(z.number()).optional(),
});

export const googleConfigSchema = commonLLMConfigSchema.extend({
	topK: z.number().positive().optional(),
	stopSequences: z.array(z.string()).optional(),
});

export const ollamaConfigSchema = commonLLMConfigSchema.extend({
	// Ollama uses OpenAI-compatible API
});

export const groqConfigSchema = commonLLMConfigSchema.extend({
	// Groq uses OpenAI-compatible API
});

export const openrouterConfigSchema = commonLLMConfigSchema.extend({
	// OpenRouter uses OpenAI-compatible API with custom headers
});

// Union schema for all providers
export const llmConfigSchema = z.discriminatedUnion("provider", [
	z.object({ provider: z.literal("anthropic") }).merge(anthropicConfigSchema),
	z.object({ provider: z.literal("openai") }).merge(openaiConfigSchema),
	z.object({ provider: z.literal("google") }).merge(googleConfigSchema),
	z.object({ provider: z.literal("ollama") }).merge(ollamaConfigSchema),
	z.object({ provider: z.literal("groq") }).merge(groqConfigSchema),
	z.object({ provider: z.literal("openrouter") }).merge(openrouterConfigSchema),
]);

export type LLMConfig = z.infer<typeof llmConfigSchema>;
export type CommonLLMConfig = z.infer<typeof commonLLMConfigSchema>;

/**
 * LLM environment variables schema.
 * These are fallback values when no DB config exists.
 */
export const llmEnvSchema = z.object({
	// Provider selection - uses dynamic schema derived from LLM_PROVIDERS
	PRISMALENS_LLM_PROVIDER: llmProviderIdSchema
		.default("anthropic")
		.describe("Default LLM provider"),

	// API Keys (one per provider) - Keep standard names for external services
	ANTHROPIC_API_KEY: z.string().optional().describe("Anthropic API key"),
	OPENAI_API_KEY: z.string().optional().describe("OpenAI API key"),
	GOOGLE_API_KEY: z.string().optional().describe("Google Gemini API key"),
	GROQ_API_KEY: z.string().optional().describe("Groq API key"),
	OPENROUTER_API_KEY: z.string().optional().describe("OpenRouter API key"),
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
