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
 * Adversary challenge record - tracks challenges made to hypotheses
 * Used by the Adversary SubAgent for Devil's Advocate reasoning
 */
export const AdversaryChallengeSchema = z.object({
	hypothesisId: z.string().describe("ID of the hypothesis being challenged"),
	originalConfidence: z.number().min(0).max(100),
	originalEvidenceCount: z.number().min(0),
	challenges: z.array(
		z.object({
			type: z.enum(["assumption", "blind_spot", "alternative"]),
			description: z.string(),
			evidence: z.string().optional(),
			source: z.string().optional(),
		}),
	),
	alternativeHypotheses: z.array(z.string()),
	recommendedConfidenceAdjustment: z.number().min(-0.5).max(0),
	refinedHypothesis: z
		.object({
			claim: z.string().optional(),
			confidence: z.number().optional(),
			evidence: z.array(z.string()).optional(),
		})
		.optional(),
	skillsUsed: z.array(z.string()),
	timestamp: z.string(),
});

export type AdversaryChallenge = z.infer<typeof AdversaryChallengeSchema>;

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
// PRE-GATHERED CONTEXT SCHEMAS
// =============================================================================
// Pre-commander data gathering schemas based on BigPanda enrichment patterns.
// Key insight: 60-90% of incidents are change-related, so pre-gathering
// change context dramatically improves investigation quality.
// =============================================================================

/**
 * Timeline event for alert activity
 */
export const AlertTimelineEventSchema = z.object({
	alertId: z.string(),
	event: z.string(),
	timestamp: z.string(),
});

export type AlertTimelineEvent = z.infer<typeof AlertTimelineEventSchema>;

/**
 * Gathered alerts context - full details, not just counts
 */
export const GatheredAlertsContextSchema = z.object({
	/** Full alert details for all correlated alerts */
	full: z.array(AlertContextSchema),
	/** Primary alert that triggered the investigation */
	primary: AlertContextSchema.nullable(),
	/** Timeline of alert events */
	timeline: z.array(AlertTimelineEventSchema),
	/** Alerts grouped by service for easier analysis */
	groupedByService: z.record(z.string(), z.array(AlertContextSchema)),
});

export type GatheredAlertsContext = z.infer<typeof GatheredAlertsContextSchema>;

/**
 * Deployment change with risk scoring (BigPanda pattern)
 */
export const DeploymentChangeSchema = z.object({
	id: z.string(),
	timestamp: z.string(),
	service: z.string().optional(),
	environment: z.string().optional(),
	version: z.string().optional(),
	status: z.enum(["success", "failed", "rolled_back", "in_progress"]).optional(),
	containsMigration: z.boolean().optional(),
	/** Risk score 0-100 based on time proximity and change characteristics */
	riskScore: z.number().min(0).max(100),
	/** Factors contributing to risk score */
	riskFactors: z.array(z.string()),
	/** Link to deployment details */
	url: z.string().optional(),
});

export type DeploymentChange = z.infer<typeof DeploymentChangeSchema>;

/**
 * Git commit change
 */
export const CommitChangeSchema = z.object({
	sha: z.string(),
	message: z.string(),
	author: z.string(),
	timestamp: z.string(),
	repository: z.string().optional(),
	url: z.string().optional(),
});

export type CommitChange = z.infer<typeof CommitChangeSchema>;

/**
 * Configuration change
 */
export const ConfigChangeSchema = z.object({
	key: z.string(),
	oldValue: z.string().optional(),
	newValue: z.string().optional(),
	timestamp: z.string(),
	source: z.string().optional(),
});

export type ConfigChange = z.infer<typeof ConfigChangeSchema>;

/**
 * Recent changes context - deployments, commits, config changes
 * BigPanda pattern: 60-90% of incidents are change-related
 */
export const RecentChangesContextSchema = z.object({
	/** Recent deployments with risk scores */
	deployments: z.array(DeploymentChangeSchema),
	/** Recent commits in relevant repositories */
	commits: z.array(CommitChangeSchema),
	/** Recent configuration changes */
	configChanges: z.array(ConfigChangeSchema),
});

export type RecentChangesContext = z.infer<typeof RecentChangesContextSchema>;

/**
 * Similar incident match
 */
export const SimilarIncidentMatchSchema = z.object({
	incidentId: z.string(),
	number: z.number().optional(),
	title: z.string().optional(),
	/** Similarity score 0-100 (BigPanda uses 30% threshold) */
	similarity: z.number().min(0).max(100),
	/** How it was resolved (if resolved) */
	resolution: z.string().optional(),
	/** Root cause from that incident */
	rootCause: z.string().optional(),
	/** Time to resolve in seconds */
	timeToResolve: z.number().optional(),
	resolvedAt: z.string().optional(),
});

export type SimilarIncidentMatch = z.infer<typeof SimilarIncidentMatchSchema>;

/**
 * Recurring incident pattern
 */
export const IncidentPatternSchema = z.object({
	pattern: z.string(),
	count: z.number(),
	lastOccurrence: z.string(),
	serviceName: z.string().optional(),
});

export type IncidentPattern = z.infer<typeof IncidentPatternSchema>;

/**
 * Past resolution info
 */
export const PastResolutionSchema = z.object({
	incidentId: z.string(),
	summary: z.string(),
	timeToResolve: z.number(), // seconds
	rootCauseCategory: z.string().optional(),
});

export type PastResolution = z.infer<typeof PastResolutionSchema>;

/**
 * Similar incidents context (BigPanda 30% threshold pattern)
 */
export const SimilarIncidentsContextSchema = z.object({
	/** Similar past incidents with similarity scores */
	incidents: z.array(SimilarIncidentMatchSchema),
	/** Recurring patterns identified */
	patterns: z.array(IncidentPatternSchema),
	/** Past resolutions for learning */
	resolutions: z.array(PastResolutionSchema),
});

export type SimilarIncidentsContext = z.infer<
	typeof SimilarIncidentsContextSchema
>;

/**
 * Service info for context
 */
export const ServiceInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	displayName: z.string().optional(),
	type: z.string().optional(),
	tier: z.string().optional(),
	team: z.string().optional(),
	repository: z.string().optional(),
});

export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

/**
 * Service health status
 */
export const ServiceHealthStatusSchema = z.object({
	status: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
	lastCheck: z.string().optional(),
	message: z.string().optional(),
});

export type ServiceHealthStatus = z.infer<typeof ServiceHealthStatusSchema>;

/**
 * Service context - service info and dependencies
 */
export const ServiceContextSchema = z.object({
	/** Primary service info */
	service: ServiceInfoSchema.nullable(),
	/** Services this service depends on */
	dependencies: z.array(z.string()),
	/** Services that depend on this service */
	dependents: z.array(z.string()),
	/** Health status of related services */
	healthStatus: z.array(ServiceHealthStatusSchema),
});

export type ServiceContext = z.infer<typeof ServiceContextSchema>;

/**
 * Pre-gathered metrics
 */
export const GatheredMetricsSchema = z.object({
	/** Mean time to acknowledge for similar incidents */
	mtta: z.number().nullable(),
	/** Mean time to resolve for similar incidents */
	mttr: z.number().nullable(),
	/** Time since first alert in seconds */
	timeSinceFirstAlert: z.number(),
	/** Rate of alerts per minute */
	alertVelocity: z.number(),
	/** List of affected service names */
	affectedServices: z.array(z.string()),
	/** Number of similar incidents in past 30 days */
	similarIncidentCount: z.number().optional(),
});

export type GatheredMetrics = z.infer<typeof GatheredMetricsSchema>;

/**
 * Log entry for preview
 */
export const LogEntrySchema = z.object({
	message: z.string(),
	timestamp: z.string(),
	level: z.enum(["error", "warn", "info", "debug"]),
	service: z.string().optional(),
	traceId: z.string().optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * Pre-scanned log preview (if integration available)
 */
export const LogPreviewContextSchema = z.object({
	/** Sample of error/warning logs */
	errorLogs: z.array(LogEntrySchema),
	/** Time range of logs fetched */
	timeRange: z.object({
		start: z.string(),
		end: z.string(),
	}),
	/** Source of the logs */
	source: z.string().optional(),
});

export type LogPreviewContext = z.infer<typeof LogPreviewContextSchema>;

/**
 * Gathering metadata for observability
 */
export const GatheringMetaSchema = z.object({
	/** Total time spent gathering in milliseconds */
	durationMs: z.number(),
	/** Data sources that were queried */
	sourcesQueried: z.array(z.string()),
	/** Errors encountered during gathering (graceful degradation) */
	errors: z.array(
		z.object({
			source: z.string(),
			error: z.string(),
		}),
	),
	/** Overall quality score 0-1 based on completeness */
	qualityScore: z.number().min(0).max(1),
});

export type GatheringMeta = z.infer<typeof GatheringMetaSchema>;

/**
 * Complete pre-gathered context structure
 * Gathered before Commander starts to provide rich initial context
 */
export const PreGatheredContextSchema = z.object({
	/** Alerts context with full details */
	alerts: GatheredAlertsContextSchema,
	/** Recent changes - deployments, commits, config (BigPanda pattern) */
	recentChanges: RecentChangesContextSchema,
	/** Similar past incidents for pattern matching */
	similarIncidents: SimilarIncidentsContextSchema,
	/** Service context - info and topology */
	serviceContext: ServiceContextSchema,
	/** Calculated metrics */
	metrics: GatheredMetricsSchema,
	/** Pre-scanned log preview (nullable if no logging integration) */
	logPreview: LogPreviewContextSchema.nullable(),
	/** Gathering metadata */
	gatheringMeta: GatheringMetaSchema,
});

export type PreGatheredContext = z.infer<typeof PreGatheredContextSchema>;

/**
 * Pending alert that arrived during an ongoing investigation
 */
export const PendingAlertSchema = z.object({
	alertId: z.string(),
	title: z.string(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	addedAt: z.string(),
});

export type PendingAlert = z.infer<typeof PendingAlertSchema>;

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

	/** Primary alert that triggered the investigation, useful for quick access */
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
	// Pre-Gathered Context (before Commander)
	// =========================================================================

	/**
	 * Pre-gathered context fetched before Commander starts.
	 * Contains alerts, changes, similar incidents, service context, and metrics.
	 * Based on BigPanda enrichment pattern - 60-90% of incidents are change-related.
	 */
	preGatheredContext: Annotation<PreGatheredContext | null>({
		reducer: (current, update) => update ?? current,
		default: () => null,
	}),

	/**
	 * Alerts that arrived during an ongoing investigation.
	 * Commander can use these for awareness during analysis.
	 */
	pendingAlerts: Annotation<PendingAlert[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => [],
	}),

	// =========================================================================
	// Investigation Findings
	// =========================================================================

	/** Context gathered by Cartographer agent (legacy - for backwards compatibility) */
	gatheredContext: Annotation<Record<string, unknown>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({}),
	}),

	/** Hypotheses formed by Detective agent */
	hypotheses: Annotation<Hypothesis[]>({
		reducer: (current, update) => [...current, ...update],
		default: () => [],
	}),

	/** Challenges from Adversary agent (Devil's Advocate) */
	adversaryChallenges: Annotation<AdversaryChallenge[]>({
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
 * Requires incident context with optional alerts for supporting data.
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
