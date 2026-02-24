/**
 * Investigation Progress Schemas
 *
 * Zod schemas for investigation progress tracking.
 * Derives from @prismalens/config/agents SSOT for agent names.
 */

import { ROUTABLE_AGENT_IDS } from "@prismalens/config/agents";
import { z } from "zod";
import { AgentNameSchema } from "./common.js";

// =============================================================================
// AGENT NAME SCHEMAS (SSOT-derived)
// =============================================================================

/**
 * Routable agent name schema — agents the supervisor can route to.
 * Derived from config SSOT ROUTABLE_AGENT_IDS.
 */
export const RoutableAgentNameSchema = z.enum(ROUTABLE_AGENT_IDS);

export type RoutableAgentNameType = z.infer<typeof RoutableAgentNameSchema>;

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
	currentNode: AgentNameSchema.nullable(),
	currentAgent: AgentNameSchema.nullable(),
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
	currentNode: AgentNameSchema.nullable(),
	findings: z.number(),
	hypotheses: z.number(),
	confidence: z.number().nullable(),
});

export type ProgressSnapshotType = z.infer<typeof ProgressSnapshotSchema>;
