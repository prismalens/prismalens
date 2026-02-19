import { z } from "zod";

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
