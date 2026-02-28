/**
 * Input types for investigation executor.
 *
 * Simplified: only incidentId + config. Scout fetches incident + alerts
 * via DataProvider at runtime. Credentials flow through IntegrationWithCredentials
 * and are bound into http_request tool + workspace env at graph build time.
 */

import type { IntegrationWithCredentials } from "./contexts.js"

/**
 * Complete input to the investigation executor.
 * Scout node fetches incident/alerts via DataProvider — not passed in here.
 */
export interface InvestigationInput {
  investigationId: string
  incidentId: string
  config: InvestigationConfig
  integrations: IntegrationWithCredentials[]
}

/**
 * Configuration for investigation execution.
 */
export interface InvestigationConfig {
  llm: LLMProviderConfig
  maxIterations?: number
  timeout?: number
}

/**
 * Base LLM provider configuration.
 * API key resolved by LLM factory from process.env — not stored in state.
 */
export interface LLMProviderConfig {
  provider:
    | "anthropic"
    | "openai"
    | "groq"
    | "ollama"
    | "google"
    | "openrouter"
  model: string
  /**
   * Prefer environment variables (ANTHROPIC_API_KEY, etc.) over this field.
   * API keys in config may be logged or persisted in checkpoints.
   * @deprecated Use environment variables for API keys
   */
  apiKey?: string
  baseURL?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
}
