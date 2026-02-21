/**
 * @prismalens/agents — Multi-agent investigation executor.
 *
 * This package provides a LangGraph-based investigation executor with:
 * - Deterministic scout + LLM-driven supervisor routing
 * - Skill-based tool progressive disclosure
 * - Subgraph agents (analyst, resolver) with structured output
 * - DataProvider injection for data source abstraction
 * - Stream-only executor API with progress events
 */

// =============================================================================
// Executor
// =============================================================================

export { InvestigationExecutor } from "./executor/index.js"
export type { InvestigationExecutorDeps } from "./executor/investigation-executor.js"

// =============================================================================
// Types - Contexts
// =============================================================================

export type {
  IncidentContext,
  AlertContext,
  IntegrationContext,
  SimilarIncidentMatch,
} from "./types/contexts.js"

// =============================================================================
// Types - Inputs
// =============================================================================

export type {
  InvestigationInput,
  InvestigationConfig,
  LLMProviderConfig,
} from "./types/inputs.js"

// =============================================================================
// Types - Results
// =============================================================================

export type {
  InvestigationResult,
  Hypothesis,
  Evidence,
  Recommendation,
} from "./types/results.js"

// =============================================================================
// Types - State
// =============================================================================

export type {
  InvestigationState,
  InvestigationPhase,
  SupervisorPhase,
  AgentName,
  GraphNodeId,
  GatheredData,
  DataCoverage,
  SourceCoverage,
  ProgressSnapshot,
} from "./types/state.js"

// =============================================================================
// Types - Progress Events
// =============================================================================

export type {
  InvestigationProgressEvent,
  NodeCompleteEvent,
  ProgressEvent,
  PhaseChangeEvent,
  HypothesisFormedEvent,
  RecommendationAddedEvent,
  StalledEvent,
  CompletedEvent,
} from "./types/progress.js"

// =============================================================================
// Providers
// =============================================================================

export type {
  DataProvider,
  AlertFetchRequest,
  AlertFetchResponse,
  SimilarIncidentRequest,
  SimilarIncidentResponse,
  ChangeEventContext,
} from "./providers/index.js"

export { StubDataProvider } from "./providers/index.js"

// =============================================================================
// LLM Factory
// =============================================================================

export { createLLM } from "./llm/index.js"

// =============================================================================
// Tools
// =============================================================================

export { ToolRegistry } from "./tools/index.js"
export type { Skill, ToolBundle, ToolCategory } from "./tools/index.js"
export { MCPClientManager } from "./tools/index.js"
export type { MCPServerConfig } from "./tools/index.js"
export { INVESTIGATION_PHASES } from "./tools/schemas.js"
export type { InvestigationPhaseValue } from "./tools/schemas.js"

// =============================================================================
// Utilities
// =============================================================================

export { mapSeverity } from "./utils/severity.js"
export {
  mapHypothesisCategoryToDb,
  mapAgentUrgencyToDb,
  mapFixCategoryToDb,
  mapToolCategoryToDb,
} from "./utils/enum-maps.js"
export {
  getCheckpoint,
  listCheckpoints,
  getStateFromCheckpoint,
  getCheckpointTimestamp,
  getBestHypothesis,
} from "./utils/checkpoints.js"
export { safeFetch } from "./utils/safe-fetch.js"
export type { SafeFetchResult } from "./utils/safe-fetch.js"

// =============================================================================
// Agent Constants (re-exported from @prismalens/config/agents SSOT)
// =============================================================================

export { ROUTABLE_AGENT_IDS, type RoutableAgentId } from "@prismalens/config/agents"

// =============================================================================
// Model Registry (stubs for compatibility)
// =============================================================================

/**
 * Get available models for a provider (stubbed)
 */
export async function getModelsForProvider(_provider: string): Promise<unknown[]> {
  return []
}

/**
 * Get complete models registry (stubbed)
 */
export async function getModelsRegistry(): Promise<unknown[]> {
  return []
}
