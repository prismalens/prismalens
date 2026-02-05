/**
 * Investigation Progress Schemas
 *
 * Zod schemas for investigation progress tracking.
 * Derives from @prismalens/agents metadata to ensure consistency.
 */

import { z } from "zod";

// =============================================================================
// PHASE & NODE SCHEMAS
// =============================================================================

/**
 * Investigation phase schema.
 * Matches INVESTIGATION_PHASES from @prismalens/agents/graph/metadata.
 */
export const InvestigationPhaseSchema = z.enum([
	"pre_gathering",
	"gathering",
	"targeted_gather",
	"analyzing",
	"challenging",
	"fixing",
	"complete",
]);

export type InvestigationPhaseType = z.infer<typeof InvestigationPhaseSchema>;

/**
 * Graph node ID schema.
 * Matches GRAPH_NODES from @prismalens/agents/graph/metadata.
 */
export const GraphNodeIdSchema = z.enum([
	"validateIncident",
	"preGather",
	"cloneIfNeeded",
	"prepareSupervisor",
	"supervisor",
	"qualityGate",
	"processHandoff",
	"gatherer-coordinator",
	"log-gatherer",
	"code-searcher",
	"change-tracker",
	"detective",
	"adversary",
	"surgeon",
	"writeToApi",
]);

export type GraphNodeIdType = z.infer<typeof GraphNodeIdSchema>;

/**
 * Agent name schema.
 * Matches AGENT_NAMES from @prismalens/agents/graph/metadata.
 */
export const SupervisorAgentNameSchema = z.enum([
	"log-gatherer",
	"code-searcher",
	"change-tracker",
	"detective",
	"adversary",
	"surgeon",
]);

export type SupervisorAgentNameType = z.infer<typeof SupervisorAgentNameSchema>;

// =============================================================================
// PROGRESS STATUS
// =============================================================================

/**
 * Investigation execution status.
 */
export const InvestigationProgressStatusSchema = z.enum([
	"pending",
	"validating",
	"running",
	"completed",
	"failed",
]);

export type InvestigationProgressStatusType = z.infer<
	typeof InvestigationProgressStatusSchema
>;

// =============================================================================
// HANDOFF RECORD
// =============================================================================

/**
 * Handoff record schema.
 */
export const HandoffRecordSchema = z.object({
	id: z.string(),
	traceId: z.string().optional(),
	from: z.string(),
	to: z.string(),
	reason: z.string(),
	context: z.record(z.unknown()).optional(),
	status: z.enum(["pending", "dispatched", "denied", "completed", "failed"]),
	denialReason: z.string().optional(),
	requestedAt: z.string(),
	dispatchedAt: z.string().optional(),
	completedAt: z.string().optional(),
	resultSummary: z.string().optional(),
	findingsAdded: z.number().optional(),
});

export type HandoffRecordType = z.infer<typeof HandoffRecordSchema>;

// =============================================================================
// DATA QUALITY
// =============================================================================

/**
 * Correlation result schema.
 */
export const CorrelationResultSchema = z.object({
	logCodeOverlap: z.number(),
	codeChangeOverlap: z.number(),
	changeTimeCorrelation: z.number(),
	overallCorrelation: z.number(),
});

/**
 * Data quality info schema.
 */
export const DataQualityInfoSchema = z
	.object({
		incident: z.number().optional(),
		alerts: z.number().optional(),
		gathered: z.number().optional(),
		preGathering: z.number().optional(),
		correlations: CorrelationResultSchema.optional(),
	})
	.catchall(z.union([z.number(), CorrelationResultSchema, z.undefined()]));

export type DataQualityInfoType = z.infer<typeof DataQualityInfoSchema>;

// =============================================================================
// AGENT EXECUTION RECORD
// =============================================================================

/**
 * Agent execution record schema.
 */
export const AgentExecutionRecordSchema = z.object({
	agentId: z.string(),
	startedAt: z.string(),
	completedAt: z.string().optional(),
	status: z.enum(["running", "completed", "failed"]),
	tokensUsed: z.number().optional(),
	toolCalls: z.number().optional(),
	findingsProduced: z.number().optional(),
	error: z.string().optional(),
});

export type AgentExecutionRecordType = z.infer<typeof AgentExecutionRecordSchema>;

// =============================================================================
// INVESTIGATION PROGRESS
// =============================================================================

/**
 * Full investigation progress schema.
 */
export const InvestigationProgressSchema = z.object({
	investigationId: z.string(),
	status: InvestigationProgressStatusSchema,
	phase: InvestigationPhaseSchema,
	currentNode: GraphNodeIdSchema.nullable(),
	currentAgent: SupervisorAgentNameSchema.nullable(),
	gatherIterations: z.number(),
	findings: z.number(),
	hypotheses: z.number(),
	confidence: z.number().nullable(),
	handoffHistory: z.array(HandoffRecordSchema),
	dataQuality: DataQualityInfoSchema.nullable(),
	agentExecutions: z.array(AgentExecutionRecordSchema),
	updatedAt: z.string(),
});

export type InvestigationProgressType = z.infer<typeof InvestigationProgressSchema>;

// =============================================================================
// PROGRESS SNAPSHOT (for history)
// =============================================================================

/**
 * Progress snapshot schema.
 */
export const ProgressSnapshotSchema = z.object({
	timestamp: z.string(),
	phase: InvestigationPhaseSchema,
	currentNode: GraphNodeIdSchema.nullable(),
	findings: z.number(),
	hypotheses: z.number(),
	confidence: z.number().nullable(),
});

export type ProgressSnapshotType = z.infer<typeof ProgressSnapshotSchema>;

// =============================================================================
// GRAPH VISUALIZATION
// =============================================================================

/**
 * Node status for visualization.
 */
export const NodeStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"skipped",
	"failed",
]);

/**
 * Graph node state for visualization.
 */
export const GraphNodeStateSchema = z.object({
	id: GraphNodeIdSchema,
	status: NodeStatusSchema,
	startedAt: z.string().optional(),
	completedAt: z.string().optional(),
	error: z.string().optional(),
	findingsProduced: z.number().optional(),
});

/**
 * Edge status for visualization.
 */
export const EdgeStatusSchema = z.enum(["pending", "active", "completed"]);

/**
 * Graph edge state for visualization.
 */
export const GraphEdgeStateSchema = z.object({
	from: GraphNodeIdSchema,
	to: GraphNodeIdSchema,
	label: z.string().optional(),
	status: EdgeStatusSchema,
	traversedAt: z.string().optional(),
});

/**
 * Full graph visualization state.
 */
export const GraphVisualizationStateSchema = z.object({
	nodes: z.array(GraphNodeStateSchema),
	edges: z.array(GraphEdgeStateSchema),
	activeNodeId: GraphNodeIdSchema.nullable(),
	phase: InvestigationPhaseSchema,
});

export type GraphVisualizationStateType = z.infer<
	typeof GraphVisualizationStateSchema
>;
