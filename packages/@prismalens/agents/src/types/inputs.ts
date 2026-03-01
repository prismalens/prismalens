/**
 * Input types for investigation executor.
 *
 * Simplified: only incidentId + config. Scout fetches incident + alerts
 * via DataProvider at runtime. Credentials flow through IntegrationWithCredentials
 * and are bound into http_request tool + workspace env at graph build time.
 */

import type { IntegrationWithCredentials } from "./contexts.js"
import type { LLMProviderConfig, AgentLLMOverride } from "../llm/factory.js"

// Re-export so consumers can import from types/inputs or from llm/factory
export type { LLMProviderConfig, AgentLLMOverride }

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
  agentOverrides?: Record<string, AgentLLMOverride>
  maxIterations?: number
  timeout?: number
}
