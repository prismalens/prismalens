import { z } from 'zod';

/**
 * LLM provider configuration schema.
 * Supports multiple providers via LiteLLM (BYOK - Bring Your Own Key).
 */
export const llmSchema = z.object({
  // Provider keys (at least one should be provided for LLM features)
  GOOGLE_API_KEY: z.string().optional().describe('Google AI Studio API key'),
  OPENAI_API_KEY: z.string().optional().describe('OpenAI API key'),
  ANTHROPIC_API_KEY: z.string().optional().describe('Anthropic API key'),

  // Azure OpenAI
  AZURE_API_KEY: z.string().optional().describe('Azure OpenAI API key'),
  AZURE_API_BASE: z.string().optional().describe('Azure OpenAI API base URL'),
  AZURE_API_VERSION: z.string().optional().describe('Azure OpenAI API version'),

  // LiteLLM configuration
  LITELLM_PROVIDER: z
    .string()
    .default('google')
    .describe('Default LLM provider: google, openai, anthropic, azure'),
  LITELLM_MODEL: z
    .string()
    .default('gemini-2.0-flash')
    .describe('Default model name'),
});

export type LLMConfig = z.infer<typeof llmSchema>;

/**
 * Validate that at least one LLM API key is provided.
 */
export function validateLLMConfig(config: LLMConfig): boolean {
  return !!(
    config.GOOGLE_API_KEY ||
    config.OPENAI_API_KEY ||
    config.ANTHROPIC_API_KEY ||
    config.AZURE_API_KEY
  );
}
