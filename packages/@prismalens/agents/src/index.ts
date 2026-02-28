/**
 * @prismalens/agents — Multi-agent investigation executor.
 *
 * This package provides a LangGraph-based investigation executor with:
 * - Deterministic scout + LLM-driven supervisor routing
 * - Skill-based progressive disclosure via SKILL.md files (deepagents native)
 * - Generic http_request tool with per-agent method allowlists
 * - Shared workspace via LocalShellBackend/CompositeBackend
 * - DataProvider injection for data source abstraction
 * - Stream-only executor API with progress events
 */

// =============================================================================
// Executor
// =============================================================================

export { InvestigationExecutor } from "./executor/index.js"
export type { InvestigationExecutorDeps, StreamTuple } from "./executor/investigation-executor.js"

// =============================================================================
// Types - Contexts
// =============================================================================

export type {
  IncidentContext,
  AlertContext,
  IntegrationContext,
  IntegrationWithCredentials,
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
  RoutingEvent,
  HypothesisFormedEvent,
  RecommendationAddedEvent,
  StalledEvent,
  CompletedEvent,
  ErrorEvent,
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

export type { SkillMetadata, PrismaLensSkillMetadata } from "./tools/index.js"
export { createHttpRequestTool } from "./tools/index.js"

// =============================================================================
// Integration Registry
// =============================================================================

export {
  resolveIntegration,
  computeAvailableDataSources,
  buildIntegrationEnvVars,
  resolveGitAuth,
} from "./providers/integration-registry.js"
export type {
  IntegrationAdapter,
  ResolvedIntegration,
} from "./providers/integration-registry.js"
export { getAdapter } from "./providers/adapters/index.js"

// =============================================================================
// Utilities
// =============================================================================

export { mapSeverity } from "./utils/severity.js"
export {
  getCheckpoint,
  listCheckpoints,
  getStateFromCheckpoint,
  getCheckpointTimestamp,
  getBestHypothesis,
} from "./utils/checkpoints.js"
export { createCheckpointer } from "./utils/checkpointer-factory.js"
export type { CheckpointerOptions } from "./utils/checkpointer-factory.js"
export { ExecutionTracker } from "./utils/execution-tracker.js"
export type { TrackedExecution } from "./utils/execution-tracker.js"

// =============================================================================
// Agent Constants (re-exported from @prismalens/config/agents SSOT)
// =============================================================================

export { ROUTABLE_AGENT_IDS, type RoutableAgentId } from "@prismalens/config/agents"

