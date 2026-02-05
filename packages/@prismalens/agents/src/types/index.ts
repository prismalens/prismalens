/**
 * Types Index
 *
 * Central export point for all types in the agents package.
 * Consumers should import from this file for a stable API.
 *
 * NOTE: Graph metadata (INVESTIGATION_PHASES, GRAPH_NODES, AGENT_NAMES, etc.)
 * is exported from graph/index.ts, not here, to avoid duplicate exports in
 * the main package index.
 */

// =============================================================================
// PROGRESS TYPES
// =============================================================================

export {
	type InvestigationStatus,
	type InvestigationProgress,
	type ProgressSnapshot,
	type NodeStatus,
	type GraphNodeState,
	type EdgeStatus,
	type GraphEdgeState,
	type GraphVisualizationState,
	type ProgressUpdate,
} from "./progress.js";

// =============================================================================
// AGENT IDS (Legacy - prefer AGENT_NAMES from metadata)
// =============================================================================

export { AGENT_IDS, agentIdSchema, type AgentId } from "./agents.js";

// =============================================================================
// INVESTIGATION CONFIG (Runtime - NOT Checkpointed)
// =============================================================================

export {
	type InvestigationConfig,
	hasInvestigationConfig,
	getInvestigationConfigFromConfigurable,
} from "./config.js";

// =============================================================================
// DATA PROVIDER
// =============================================================================

export {
	type AlertFetchRequest,
	type AlertFetchResponse,
	type DataProvider,
	type SimilarIncidentRequest,
	type SimilarIncidentResponse,
} from "./data-provider.js";

// =============================================================================
// SUPERVISOR PATTERN TYPES
// =============================================================================

export {
	// Phase and agent types
	type SupervisorPhase,
	type SupervisorAgentName,
	SUPERVISOR_AGENT_NAMES,
	HANDOFF_AGENT_NAMES,
	// Validation types
	type ValidationWindowLevel,
	type FindingValidation,
	FindingValidationSchema,
	// Finding types
	type Finding,
	FindingSchema,
	// Correlation types
	type CorrelationResult,
	CorrelationResultSchema,
	type DataQualityInfo,
	// Handoff types (also in handoff-manager)
	type HandoffAgentName,
	type HandoffRequest,
	HandoffRequestSchema,
	// Fix types
	type Fix,
	FixSchema,
	// Clone types
	type CloneDecision,
	type ClonedRepoInfo,
	// Error types
	type AgentError,
} from "./supervisor.js";

// =============================================================================
// SCHEMAS (Zod schemas and inferred types)
// =============================================================================

// Core input data schemas
export {
	AlertContextSchema,
	type AlertContext,
	IncidentContextSchema,
	type IncidentContext,
	IntegrationContextSchema,
	type IntegrationContext,
} from "./schemas/core.js";

// Findings schemas - investigation output
export {
	HypothesisSchema,
	type Hypothesis,
	CodeChangeSchema,
	type CodeChange,
	RecommendationSchema,
	type Recommendation,
	AdversaryChallengeSchema,
	type AdversaryChallenge,
	ToolExecutionRecordSchema,
	type ToolExecutionRecord,
	AgentExecutionRecordSchema,
	type AgentExecutionRecord,
} from "./schemas/findings.js";

// Pre-gathering schemas
export {
	AlertTimelineEventSchema,
	type AlertTimelineEvent,
	GatheredAlertsContextSchema,
	type GatheredAlertsContext,
	DeploymentChangeSchema,
	type DeploymentChange,
	CommitChangeSchema,
	type CommitChange,
	ConfigChangeSchema,
	type ConfigChange,
	RecentChangesContextSchema,
	type RecentChangesContext,
	SimilarIncidentMatchSchema,
	type SimilarIncidentMatch,
	IncidentPatternSchema,
	type IncidentPattern,
	PastResolutionSchema,
	type PastResolution,
	SimilarIncidentsContextSchema,
	type SimilarIncidentsContext,
	ServiceInfoSchema,
	type ServiceInfo,
	ServiceHealthStatusSchema,
	type ServiceHealthStatus,
	ServiceContextSchema,
	type ServiceContext,
	GatheredMetricsSchema,
	type GatheredMetrics,
	LogEntrySchema,
	type LogEntry,
	LogPreviewContextSchema,
	type LogPreviewContext,
	GatheringMetaSchema,
	type GatheringMeta,
	PreGatheredContextSchema,
	type PreGatheredContext,
	PendingAlertSchema,
	type PendingAlert,
} from "./schemas/pre-gathering.js";

// =============================================================================
// STATE (LangGraph annotation, reducers, helpers)
// =============================================================================

export {
	// LangGraph state annotation
	InvestigationStateAnnotation,
	type InvestigationState,
	type InvestigationStateUpdate,
	// Reusable reducers
	appendReducer,
	replaceReducer,
	mergeReducer,
	uniqueSetReducer,
	latestWinsReducer,
	nullableReplaceReducer,
	// Helper functions
	createInitialState,
	getBestHypothesis,
	hasSufficientConfidence,
	getIncidentDisplayInfo,
} from "./state/index.js";

// =============================================================================
// HANDOFF TYPES (from utils/handoff-manager)
// =============================================================================

// NOTE: GathererName is exported from graph/metadata.ts which is the canonical source.
// Do not re-export GathererName here to avoid duplicate exports.
export {
	type HandoffRecord,
	type HandoffRoute,
	type HandoffStatus,
	handoffManager,
	shouldStopGathering,
	HANDOFF_ROUTES,
} from "../utils/handoff-manager.js";

// Re-export HandoffAgentName from handoff-manager (authoritative source)
// Note: Also exported from supervisor.ts for convenience, but handoff-manager
// is the canonical source to avoid circular imports in handoff logic.

// =============================================================================
// TRACING UTILITIES
// =============================================================================

export {
	type TraceConfig,
	buildTraceConfig,
	mergeTraceConfig,
} from "../utils/tracing.js";

// =============================================================================
// SEVERITY MAPPING
// =============================================================================

export { mapSeverity, type StandardSeverity } from "../utils/severity.js";
