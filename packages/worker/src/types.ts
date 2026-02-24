import type {
	AgentType,
	EffortEstimate,
	ExecutionStatus,
	RecommendationCategory,
	RecommendationPriority,
	ToolCategory,
	ToolExecutionStatus,
	Urgency,
} from "@prismalens/contracts/schemas";

export interface IntegrationContext {
	type: string;
	connectionId: string;
	credentials: Record<string, unknown>;
	config: Record<string, unknown>;
	serviceOverrides?: Record<string, unknown>;
}

export interface InvestigationJobData {
	incidentId: string;
	investigationId: string;
	/** BullMQ queue priority — not a domain enum */
	priority?: "low" | "normal" | "high" | "critical";
	context?: Record<string, unknown>;
	/** @deprecated Use connectionIds instead - credentials should not be in Redis */
	integrations?: IntegrationContext[];
	/** Connection IDs for integration credentials - worker fetches on-demand */
	connectionIds?: string[];
	incidentData?: Record<string, unknown>;
	alerts?: unknown[];
}

export interface InvestigationResult {
	success: boolean;
	investigationId: string;
	incidentId: string;
	findings: {
		rootCause?: string;
		summary?: string;
		confidence?: number;
		dataSourcesUsed?: string[];
		dataQuality?: Record<string, unknown>;
	};
	recommendations: Array<{
		title: string;
		description?: string;
		priority?: RecommendationPriority;
		category?: RecommendationCategory;
		urgency?: Urgency;
		actionable?: boolean;
		estimatedEffort?: EffortEstimate;
	}>;
	agentExecutions: Array<{
		agentName: string;
		agentType?: AgentType;
		status: ExecutionStatus;
		startedAt?: string;
		completedAt?: string;
		executionTimeMs?: number;
		toolExecutions: Array<{
			toolName: string;
			toolCategory?: ToolCategory;
			arguments?: unknown;
			result?: unknown;
			status?: ToolExecutionStatus;
			executionTimeMs?: number;
			confidence?: number;
		}>;
	}>;
	error?: string;
	errorType?: string;
}
