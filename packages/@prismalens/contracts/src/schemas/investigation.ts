/**
 * Investigation, Agent Execution, and Tool Execution schemas
 */
import { z } from "zod";
import {
	AgentNameSchema,
	AgentTypeSchema,
	DateStringSchema,
	EvidenceDirectionSchema,
	EvidenceStatusSchema,
	ExecutionStatusSchema,
	HypothesisStatusSchema,
	RecommendationPrioritySchema,
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
	dataSourcesUsed: z.array(z.string()).nullable(),
	rawOutput: z.record(z.unknown()).nullable(),
	error: z.string().nullable(),
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
	langGraphThreadId: z.string().uuid().optional(),
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
	dataSourcesUsed: z.array(z.string()).optional(),
	rawOutput: z.record(z.unknown()).optional(),
	error: z.string().optional(),
	agentExecutions: z.array(CreateAgentExecutionInputSchema).optional(),
	recommendations: z.array(CreateRecommendationInputSchema).optional(),
});

// =============================================================================
// ORDERED-EVIDENCE REPORT (ADR-0002) — no numeric confidence
// =============================================================================
// The structured investigation result. Supersedes the untyped `rawOutput` blob:
// ordered hypotheses + discrete evidence status carry certainty.

export const EvidenceSchema = z.object({
	/** What was observed. */
	observation: z.string().min(1),
	/** Where it came from — the exact command or origin that produced it. */
	source: z.string().min(1),
	direction: EvidenceDirectionSchema,
	status: EvidenceStatusSchema,
	/**
	 * Links a finding to the live tool call that produced it
	 * (StreamToolResult.toolCallId), so the report view can drill into the
	 * originating output (ADR-0007). Null for `inferred` evidence with no single
	 * originating call.
	 */
	toolCallId: z.string().nullable().optional(),
});

export const HypothesisSchema = z.object({
	// Ordering is by ARRAY POSITION (most → least plausible) — the single source of
	// truth, per ADR-0002's "ordered list". No numeric rank/confidence.
	statement: z.string().min(1),
	status: HypothesisStatusSchema,
	evidence: z.array(EvidenceSchema),
});

export const RuledOutSchema = z.object({
	// A candidate cause never promoted to a ranked hypothesis. (A hypothesis that WAS
	// considered then disproved stays in `hypotheses` with status "refuted".)
	statement: z.string().min(1),
	why: z.string().min(1),
	/** The contradicting evidence that ruled it out (direction "contradicts"). */
	evidence: z.array(EvidenceSchema),
});

/** What was queried vs not — makes the investigation auditable (ADR-0002). */
export const CoverageSchema = z.object({
	queried: z.array(z.string()),
	notQueried: z.array(z.string()),
});

/**
 * A recommended next step (ADR-0002's "recommended next steps"). Carried inline so
 * the report delivered over the wire is self-contained; the persistence layer also
 * writes these as relational Recommendation rows.
 */
export const NextStepSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
	priority: RecommendationPrioritySchema.nullable().optional(),
});

export const InvestigationReportSchema = z.object({
	summary: z.string().min(1),
	rootCause: z.string().nullable(),
	rootCauseCategory: RootCauseCategorySchema.nullable(),
	/** Ordered most → least plausible (array order is the ordering). */
	hypotheses: z.array(HypothesisSchema),
	ruledOut: z.array(RuledOutSchema),
	coverage: CoverageSchema,
	nextSteps: z.array(NextStepSchema),
});

// =============================================================================
// CANONICAL INVESTIGATION STREAM (harness-agnostic)
// =============================================================================
// The adapter normalises each rented harness's native events into this ONE
// vocabulary (ADR-0008), superseding the LangGraph `[mode, data]` tuple stream.
// Drill-down tree: branch → node (`path`) → tool call. Slice 0 is a single
// branch; fan-out (Slice 1) varies `branchId` and reuses this shape unchanged.

/** Normalised tool-call provenance — one harness tool call (OpenSRE evidence model). */
export const StreamToolResultSchema = z.object({
	/** Tool name — same key as the originating agent_step `toolCalls[].name`. */
	name: z.string().min(1),
	toolCategory: ToolCategorySchema.nullable().optional(),
	/** Links this result to its call. Derive from ToolMessage.tool_call_id. */
	toolCallId: z.string(),
	/** The command/args that produced it (human-readable provenance). */
	source: z.string().min(1),
	/**
	 * Derive from ToolMessage.status === "error" (NOT from "on_tool_end fired" —
	 * LangGraph ToolNode has handleToolErrors=true and emits a failed tool as a
	 * normal end event with status "error"; MCP tools may return error-as-content).
	 */
	ok: z.boolean(),
	/** Failure message when !ok, for the drill-down. */
	error: z.string().nullable().optional(),
	/** Truncated/sanitised result. */
	preview: z.string(),
});

const StreamBaseShape = {
	runId: z.string().uuid(),
	/**
	 * Slice 0: a single constant branch. Fan-out (Slice 1) varies it. The UI's
	 * ordering + idempotent-upsert key is (branchId, seq) — NOT seq alone, since each
	 * branch is a separate harness run with its own counter.
	 */
	branchId: z.string().min(1),
	/**
	 * Structural nesting depth within a branch, from the harness checkpoint ns
	 * (LangGraph node names + task uuids; the `tools:` wrapper collapsed). These are
	 * NOT subagent names — see `label` for the human name. [] = branch top.
	 */
	path: z.array(z.string()),
	/** Per-branch monotonic sequence (adapter-assigned in arrival order). */
	seq: z.number().int(),
	/**
	 * Human-readable node/subagent label when resolvable (from the spawning `task`
	 * tool-call's subagent_type via run_id parentage); null at the branch top.
	 */
	label: z.string().nullable().optional(),
	/** Wall-clock emit time (adapter-stamped) for step/tool durations in the drill-down. */
	ts: z.string().datetime(),
};

export const CanonicalEventSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("agent_step"),
		...StreamBaseShape,
		text: z.string(),
		toolCalls: z.array(
			z.object({
				/** Stable id from AIMessage tool_calls[].id; pairs with a tool_result. */
				toolCallId: z.string(),
				name: z.string().min(1),
				/** Post-unwrap args (the deepagents {input:"<json>"} wrapper removed). */
				args: z.record(z.unknown()),
			}),
		),
	}),
	z.object({
		kind: z.literal("tool_result"),
		...StreamBaseShape,
		result: StreamToolResultSchema,
	}),
	z.object({
		kind: z.literal("branch_done"),
		...StreamBaseShape,
		/**
		 * Supervisor classification (not a harness field). The adapter maps a thrown
		 * GraphRecursionError to "budget"; genuine failures emit an `error` event.
		 */
		reason: z.enum(["submitted", "budget", "no_progress"]),
	}),
	z.object({
		kind: z.literal("error"),
		...StreamBaseShape,
		message: z.string(),
	}),
	z.object({
		kind: z.literal("report"),
		runId: z.string().uuid(),
		seq: z.number().int(),
		ts: z.string().datetime(),
		report: InvestigationReportSchema,
	}),
]);

// ---- TYPE EXPORTS (ordered-evidence + canonical stream) ----
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type RuledOut = z.infer<typeof RuledOutSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;
export type StreamToolResult = z.infer<typeof StreamToolResultSchema>;
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;
