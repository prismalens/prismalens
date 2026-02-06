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
		analysisMethod?: string;
		dataSourcesUsed?: string[];
		agentProgression?: Record<string, unknown>;
		dataQuality?: Record<string, unknown>;
	};
	recommendations: Array<{
		title: string;
		description?: string;
		priority?: string;
		category?: string;
		urgency?: string;
		actionable?: boolean;
		estimatedEffort?: string;
	}>;
	agentExecutions: Array<{
		agentName: string;
		agentType?: string;
		status: string;
		startedAt?: string;
		completedAt?: string;
		executionTimeMs?: number;
		toolExecutions: Array<{
			toolName: string;
			toolCategory?: string;
			arguments?: unknown;
			result?: unknown;
			status?: string;
			executionTimeMs?: number;
			confidence?: number;
		}>;
	}>;
	error?: string;
	errorType?: string;
}
