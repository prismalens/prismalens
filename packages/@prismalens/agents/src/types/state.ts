import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { z } from "zod";

// =============================================================================
// LANGGRAPH STATE ANNOTATION & ZOD SCHEMAS
// =============================================================================
// Defines the state schema for the investigation workflow graph.
// Uses both Zod for runtime validation and LangGraph Annotations for graph state.
// =============================================================================

// =============================================================================
// ZOD SCHEMAS - For Runtime Validation
// =============================================================================

/**
 * Alert context schema - represents a single alert in the investigation
 */
export const AlertContextSchema = z.object({
	alertId: z.string(),
	title: z.string(),
	description: z.string().optional(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	status: z
		.enum(["triggered", "acknowledged", "correlated", "resolved", "suppressed"])
		.optional(),
	source: z.string().optional(),
	sourceUrl: z.string().optional(),
	serviceId: z.string().optional(),
	serviceName: z.string().optional(),
	repository: z.string().optional(),
	labels: z.record(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	triggeredAt: z.string().optional(),
	rawPayload: z.unknown().optional(),
});

export type AlertContext = z.infer<typeof AlertContextSchema>;

/**
 * Incident context schema - represents the incident being investigated
 * This is the primary unit of investigation, with alerts as supporting data.
 */
export const IncidentContextSchema = z.object({
	incidentId: z.string(),
	number: z.number().int(),
	title: z.string(),
	description: z.string().optional(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	status: z.enum([
		"triggered",
		"investigating",
		"identified",
		"monitoring",
		"resolved",
		"closed",
	]),
	priority: z.enum(["p1", "p2", "p3", "p4", "p5"]),
	serviceId: z.string().optional(),
	serviceName: z.string().optional(),
	correlationReason: z.string().optional(),
	alertCount: z.number().int(),
	triggeredAt: z.string(),
	acknowledgedAt: z.string().optional(),
	tags: z.array(z.string()).optional(),
	customerImpact: z.string().optional(),
	affectedSystems: z.array(z.string()).optional(),
});

export type IncidentContext = z.infer<typeof IncidentContextSchema>;

/**
 * Integration context schema - credentials and config for external tools
 */
export const IntegrationContextSchema = z.object({
	type: z.string(),
	connectionId: z.string(),
	credentials: z.record(z.unknown()),
	config: z.record(z.unknown()),
	serviceOverrides: z.record(z.unknown()).optional(),
});

export type IntegrationContext = z.infer<typeof IntegrationContextSchema>;

/**
 * Hypothesis schema - Detective agent's root cause hypothesis
 */
export const HypothesisSchema = z.object({
	claim: z.string().describe("The root cause hypothesis"),
	confidence: z.number().min(0).max(100).describe("Confidence level 0-100"),
	evidence: z.array(z.string()).describe("Evidence supporting this hypothesis"),
	category: z
		.enum(["code", "config", "infrastructure", "external", "unknown"])
		.optional(),
	timestamp: z.string().optional(),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

/**
 * Code change schema - Surgeon's proposed code fix
 */
export const CodeChangeSchema = z.object({
	filePath: z.string().describe("Path to the file to modify"),
	searchBlock: z
		.string()
		.describe("Exact content to find (must match exactly)"),
	replaceBlock: z.string().describe("Content to replace with"),
	testCase: z.string().describe("How to verify this fix works"),
});

export type CodeChange = z.infer<typeof CodeChangeSchema>;

/**
 * Recommendation schema - Actionable recommendation from investigation
 */
export const RecommendationSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	priority: z.enum(["critical", "high", "medium", "low"]),
	category: z.enum([
		"code_fix",
		"config_change",
		"rollback",
		"monitoring",
		"investigation",
	]),
	urgency: z.enum(["immediate", "short_term", "long_term"]),
	actionable: z.boolean(),
	estimatedEffort: z.enum(["minutes", "hours", "days"]).optional(),
	codeChanges: z.array(CodeChangeSchema).optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * Tool execution record - tracks individual tool calls
 */
export const ToolExecutionRecordSchema = z.object({
	toolName: z.string(),
	toolCategory: z.string().optional(),
	arguments: z.unknown(),
	result: z.unknown(),
	status: z.enum(["pending", "running", "success", "error"]),
	executionTimeMs: z.number().optional(),
	confidence: z.number().optional(),
	error: z.string().optional(),
	executedAt: z.string().optional(),
});

export type ToolExecutionRecord = z.infer<typeof ToolExecutionRecordSchema>;

/**
 * Agent execution record - tracks agent invocations
 */
export const AgentExecutionRecordSchema = z.object({
	agentName: z.string(),
	agentType: z.enum(["llm", "sequential", "loop"]).optional(),
	status: z.enum(["pending", "running", "completed", "failed"]),
	startedAt: z.string().optional(),
	completedAt: z.string().optional(),
	executionTimeMs: z.number().optional(),
	output: z.unknown().optional(),
	confidence: z.number().optional(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	error: z.string().optional(),
	toolExecutions: z.array(ToolExecutionRecordSchema).optional(),
});

export type AgentExecutionRecord = z.infer<typeof AgentExecutionRecordSchema>;

// =============================================================================
// LANGGRAPH STATE ANNOTATION
// =============================================================================

/**
 * Main Investigation Graph State
 * This is the root state annotation shared across all nodes in the main graph.
 */
export const InvestigationStateAnnotation = Annotation.Root({
	// =========================================================================
	// Job Metadata
	// =========================================================================

	/** Investigation ID from the database */
	investigationId: Annotation<string>,

	/** Incident ID this investigation belongs to */
	incidentId: Annotation<string>,

	/** Priority level for the investigation */
	priority: Annotation<"low" | "normal" | "high" | "critical">({
		reducer: (x, y) => y ?? x,
		default: () => "normal",
	}),

	// =========================================================================
	// Incident Context (Primary Unit of Investigation)
	// =========================================================================

	/** The incident being investigated - primary context for the investigation */
	incident: Annotation<IncidentContext | null>({
		reducer: (current, update) => update ?? current,
		default: () => null,
	}),

	// =========================================================================
	// Alert Context (Supporting Data)
	// =========================================================================

	/** All alerts associated with this incident */
	alerts: Annotation<AlertContext[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => [],
	}),

	/** Primary alert that triggered investigation (legacy - prefer incident context) */
	primaryAlert: Annotation<AlertContext | null>,

	// =========================================================================
	// Integration Context
	// =========================================================================

	/** Available integrations for tools (GitHub, Render, etc.) */
	integrations: Annotation<IntegrationContext[]>({
		reducer: (x, y) => y ?? x,
		default: () => [],
	}),

	// =========================================================================
	// Agent Communication
	// =========================================================================

	/** Message history for agent communication */
	messages: Annotation<BaseMessage[]>({
		reducer: messagesStateReducer,
		default: () => [],
	}),

	// =========================================================================
	// Investigation Findings
	// =========================================================================

	/** Context gathered by Cartographer agent */
	gatheredContext: Annotation<Record<string, unknown>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({}),
	}),

	/** Hypotheses formed by Detective agent */
	hypotheses: Annotation<Hypothesis[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => [],
	}),

	/** Recommendations from Surgeon agent */
	recommendations: Annotation<Recommendation[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => [],
	}),

	// =========================================================================
	// Execution Tracking
	// =========================================================================

	/** Record of all agent executions */
	agentExecutions: Annotation<AgentExecutionRecord[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => [],
	}),

	/** Progression tracking for each agent */
	agentProgression: Annotation<Record<string, boolean>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({}),
	}),

	/** Data quality scores from various sources */
	dataQuality: Annotation<Record<string, number>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({}),
	}),

	/** Data sources used during investigation */
	dataSourcesUsed: Annotation<string[]>({
		reducer: (current, update) => [...new Set([...current, ...update])],
		default: () => [],
	}),

	// =========================================================================
	// Final Results
	// =========================================================================

	/** Executive summary of the investigation */
	summary: Annotation<string | null>,

	/** Identified root cause */
	rootCause: Annotation<string | null>,

	/** Root cause category */
	rootCauseCategory: Annotation<
		"code" | "config" | "infrastructure" | "external" | "unknown" | null
	>,

	/** Overall confidence score (0-100) */
	confidence: Annotation<number | null>,

	/** Analysis method used */
	analysisMethod: Annotation<string | null>,

	// =========================================================================
	// Workflow Control
	// =========================================================================

	/** Current workflow status */
	status: Annotation<
		"pending" | "validating" | "running" | "completed" | "failed"
	>({
		reducer: (x, y) => y ?? x,
		default: () => "pending",
	}),

	/** Error message if workflow failed */
	error: Annotation<string | null>,

	/** Raw output from DeepAgent commander (for debugging) */
	commanderResult: Annotation<unknown>,

	/** Iteration count for max iterations check */
	iterationCount: Annotation<number>({
		reducer: (x, y) => y ?? x,
		default: () => 0,
	}),

	/** Maximum allowed iterations */
	maxIterations: Annotation<number>({
		reducer: (x, y) => y ?? x,
		default: () => 10,
	}),
});

/**
 * Type for the investigation state
 */
export type InvestigationState = typeof InvestigationStateAnnotation.State;

/**
 * Type for state update (partial state)
 */
export type InvestigationStateUpdate = Partial<InvestigationState>;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create initial state from job data.
 * Supports both incident-centric (preferred) and alert-centric (legacy) initialization.
 */
export function createInitialState(jobData: {
	investigationId: string;
	incidentId: string;
	priority?: "low" | "normal" | "high" | "critical";
	incident?: IncidentContext;
	alerts?: AlertContext[];
	integrations?: IntegrationContext[];
}): Partial<InvestigationState> {
	return {
		investigationId: jobData.investigationId,
		incidentId: jobData.incidentId,
		priority: jobData.priority || "normal",
		incident: jobData.incident || null,
		alerts: jobData.alerts || [],
		primaryAlert: jobData.alerts?.[0] || null,
		integrations: jobData.integrations || [],
		status: "pending",
	};
}

/**
 * Extract the best hypothesis from state
 */
export function getBestHypothesis(
	state: InvestigationState,
): Hypothesis | null {
	if (state.hypotheses.length === 0) {
		return null;
	}
	return state.hypotheses.reduce(
		(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
		null as Hypothesis | null,
	);
}

/**
 * Check if investigation has sufficient confidence to proceed to fix proposal
 */
export function hassufficientConfidence(
	state: InvestigationState,
	threshold: number = 80,
): boolean {
	const best = getBestHypothesis(state);
	return best !== null && best.confidence >= threshold;
}

/**
 * Get incident display info from state.
 * Returns incident context if available, otherwise builds context from primary alert.
 */
export function getIncidentDisplayInfo(state: InvestigationState): {
	incidentId: string;
	number?: number;
	title: string;
	description?: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	priority: string;
	serviceName?: string;
	alertCount: number;
} {
	// Prefer incident context if available
	if (state.incident) {
		return {
			incidentId: state.incident.incidentId,
			number: state.incident.number,
			title: state.incident.title,
			description: state.incident.description,
			severity: state.incident.severity,
			priority: state.incident.priority,
			serviceName: state.incident.serviceName,
			alertCount: state.incident.alertCount,
		};
	}

	// Fallback to alert-based context
	const primaryAlert = state.primaryAlert || state.alerts[0];
	return {
		incidentId: state.incidentId,
		title: primaryAlert?.title || "Unknown incident",
		description: primaryAlert?.description,
		severity: primaryAlert?.severity || "medium",
		priority: state.priority,
		serviceName: primaryAlert?.serviceName,
		alertCount: state.alerts.length,
	};
}

/**
 * Map priority string to incident priority format
 */
export function mapPriorityToIncidentPriority(
	priority: "low" | "normal" | "high" | "critical",
): "p1" | "p2" | "p3" | "p4" | "p5" {
	const mapping: Record<string, "p1" | "p2" | "p3" | "p4" | "p5"> = {
		critical: "p1",
		high: "p2",
		normal: "p3",
		low: "p4",
	};
	return mapping[priority] || "p3";
}
