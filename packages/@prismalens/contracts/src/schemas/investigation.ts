/**
 * Investigation, Agent Execution, and Tool Execution schemas
 */
import { z } from "zod";
import {
	AgentNameSchema,
	AgentTypeSchema,
	DateStringSchema,
	ExecutionStatusSchema,
	RootCauseCategorySchema,
	ToolCategorySchema,
	ToolExecutionStatusSchema,
	WorkflowStatusSchema,
} from "./common.js";

// =============================================================================
// TOOL EXECUTION SCHEMAS
// =============================================================================

export const ToolExecutionSchema = z.object({
	id: z.string().uuid(),
	agentExecutionId: z.string().uuid(),
	toolName: z.string(),
	toolCategory: ToolCategorySchema.nullable(),
	arguments: z.record(z.unknown()).nullable(),
	result: z.record(z.unknown()).nullable(),
	status: ToolExecutionStatusSchema,
	executionTimeMs: z.number().int().nullable(),
	confidence: z.number().min(0).max(1).nullable(),
	dataQuality: z.string().nullable(),
	error: z.string().nullable(),
	executedAt: DateStringSchema,
});

// =============================================================================
// AGENT EXECUTION SCHEMAS
// =============================================================================

export const AgentExecutionSchema = z.object({
	id: z.string().uuid(),
	investigationId: z.string().uuid(),
	agentName: AgentNameSchema,
	agentType: AgentTypeSchema,
	status: ExecutionStatusSchema,
	startedAt: DateStringSchema.nullable(),
	completedAt: DateStringSchema.nullable(),
	executionTimeMs: z.number().int().nullable(),
	output: z.record(z.unknown()).nullable(),
	confidence: z.number().min(0).max(1).nullable(),
	inputTokens: z.number().int().nullable(),
	outputTokens: z.number().int().nullable(),
	error: z.string().nullable(),
	createdAt: DateStringSchema,
});

export const AgentExecutionWithToolsSchema = AgentExecutionSchema.extend({
	toolExecutions: z.array(ToolExecutionSchema).optional(),
});

// =============================================================================
// INVESTIGATION SCHEMAS
// =============================================================================

export const InvestigationSchema = z.object({
	id: z.string().uuid(),
	incidentId: z.string().uuid(),
	status: WorkflowStatusSchema,
	startedAt: DateStringSchema.nullable(),
	completedAt: DateStringSchema.nullable(),
	summary: z.string().nullable(),
	rootCause: z.string().nullable(),
	rootCauseCategory: RootCauseCategorySchema.nullable(),
	confidence: z.number().min(0).max(1).nullable(),
	dataQuality: z.record(z.unknown()).nullable(),
	analysisMethod: z.string().nullable(),
	dataSourcesUsed: z.array(z.string()).nullable(),
	rawOutput: z.record(z.unknown()).nullable(),
	error: z.string().nullable(),
	agentProgression: z.record(z.unknown()).nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateInvestigationSchema = z.object({
	incidentId: z.string().uuid(),
});

// =============================================================================
// INVESTIGATION WITH RELATIONS
// =============================================================================

// Recommendation reference (minimal)
const RecommendationRefSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	priority: z.string(),
	status: z.string(),
});

export const InvestigationWithRelationsSchema = InvestigationSchema.extend({
	agentExecutions: z.array(AgentExecutionWithToolsSchema).optional(),
	recommendations: z.array(RecommendationRefSchema).optional(),
});

// =============================================================================
// INVESTIGATION STATUS (includes job queue info)
// =============================================================================

export const InvestigationStatusSchema = z.object({
	investigation: InvestigationSchema,
	job: z
		.object({
			id: z.string(),
			state: z.string(),
			progress: z.number().min(0).max(100).nullable(),
			attemptsMade: z.number().int(),
			failedReason: z.string().nullable(),
		})
		.nullable(),
});

// =============================================================================
// INVESTIGATION QUERY SCHEMAS
// =============================================================================

export const InvestigationQuerySchema = z.object({
	incidentId: z.string().uuid().optional(),
	status: WorkflowStatusSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ToolExecution = z.infer<typeof ToolExecutionSchema>;
export type AgentExecution = z.infer<typeof AgentExecutionSchema>;
export type AgentExecutionWithTools = z.infer<
	typeof AgentExecutionWithToolsSchema
>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type CreateInvestigationInput = z.infer<
	typeof CreateInvestigationSchema
>;
export type InvestigationWithRelations = z.infer<
	typeof InvestigationWithRelationsSchema
>;
export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;
export type InvestigationQuery = z.infer<typeof InvestigationQuerySchema>;

// =============================================================================
// WORKER INPUT SCHEMAS
// =============================================================================

export const UpdateInvestigationStatusSchema = z.object({
	id: z.string().uuid(),
	status: WorkflowStatusSchema,
	error: z.string().optional(),
});

export const CreateToolExecutionInputSchema = z.object({
	toolName: z.string(),
	toolCategory: z.string().optional(), // Using string directly to be permissive for inputs
	arguments: z.record(z.unknown()).nullable().optional(),
	result: z.record(z.unknown()).nullable().optional(),
	status: ToolExecutionStatusSchema.optional(),
	executionTimeMs: z.number().int().optional(),
	confidence: z.number().optional(),
	dataQuality: z.string().optional(),
	error: z.string().optional(),
});

export const CreateAgentExecutionInputSchema = z.object({
	agentName: z.string(),
	agentType: z.string().optional(),
	status: ExecutionStatusSchema.optional(),
	startedAt: z.string().datetime().optional(),
	completedAt: z.string().datetime().optional(),
	executionTimeMs: z.number().int().optional(),
	output: z.record(z.unknown()).optional(),
	confidence: z.number().optional(),
	inputTokens: z.number().int().optional(),
	outputTokens: z.number().int().optional(),
	error: z.string().optional(),
	toolExecutions: z.array(CreateToolExecutionInputSchema).optional(),
});

export const CreateRecommendationInputSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	priority: z.string().optional(), // 'low' | 'medium' | 'high' | 'critical'
	category: z.string().optional(),
	urgency: z.string().optional(),
	actionable: z.boolean().optional(),
	estimatedEffort: z.string().optional(),
});

export const WriteInvestigationResultSchema = z.object({
	id: z.string().uuid(),
	status: WorkflowStatusSchema,
	summary: z.string().optional(),
	rootCause: z.string().optional(),
	rootCauseCategory: z.string().optional(),
	confidence: z.number().optional(),
	dataQuality: z.record(z.unknown()).optional(),
	agentProgression: z.record(z.unknown()).optional(),
	dataSourcesUsed: z.array(z.string()).optional(),
	analysisMethod: z.string().optional(),
	rawOutput: z.record(z.unknown()).optional(),
	error: z.string().optional(),
	agentExecutions: z.array(CreateAgentExecutionInputSchema).optional(),
	recommendations: z.array(CreateRecommendationInputSchema).optional(),
});
