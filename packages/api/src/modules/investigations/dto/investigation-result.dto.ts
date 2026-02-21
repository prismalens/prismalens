import { RecommendationPriority, RootCauseCategory, Urgency } from "../../../shared/enums/index.js";

/**
 * DTO for investigation result (sent by worker when complete)
 */
export class InvestigationResultDto {
	/** Executive summary of findings */
	summary?: string;

	/** Identified root cause */
	rootCause?: string;

	/** Root cause category */
	rootCauseCategory?: RootCauseCategory;

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
		priority?: RecommendationPriority;
		category?: string;
		urgency?: Urgency;
	}>;
}
