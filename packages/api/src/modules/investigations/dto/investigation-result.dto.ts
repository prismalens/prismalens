/**
 * DTO for investigation result (sent by worker when complete)
 */
export class InvestigationResultDto {
	/** Executive summary of findings */
	summary?: string;

	/** Identified root cause */
	rootCause?: string;

	/** Root cause category: code, config, infrastructure, external, unknown */
	rootCauseCategory?:
		| "code"
		| "config"
		| "infrastructure"
		| "external"
		| "unknown";

	/** Confidence score (0.0 to 1.0) */
	confidence?: number;

	/** Data quality scores per source */
	dataQuality?: Record<string, number>;

	/** Which agents completed */
	agentProgression?: Record<string, boolean>;

	/** Data sources used in analysis */
	dataSourcesUsed?: string[];

	/** Analysis method description */
	analysisMethod?: string;

	/** Raw output from agents */
	rawOutput?: Record<string, unknown>;

	/** Error message if failed */
	error?: string;

	/** Recommendations generated */
	recommendations?: Array<{
		title: string;
		description?: string;
		priority?: "critical" | "high" | "medium" | "low";
		category?: string;
		urgency?: "immediate" | "short_term" | "long_term";
	}>;
}
