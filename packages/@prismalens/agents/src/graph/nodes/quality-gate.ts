/**
 * Quality Gate Node
 *
 * Validates gathered findings before passing to Detective agent.
 * Calculates overall data quality score and cross-correlations.
 * Decides whether to proceed, expand time window, or warn about low quality.
 *
 * Flow:
 * - If score >= threshold: proceed to Detective
 * - If score < threshold && windowLevel < 3: expand window, re-gather
 * - If score < threshold && windowLevel = 3: proceed with warning
 */

import { Logger } from "@prismalens/logger";
import type {
	InvestigationState,
	SupervisorPhase,
	ValidationWindowLevel,
} from "../../types/index.js";
import {
	calculateDataQualityScore,
	checkCrossCorrelation,
	meetsQualityThreshold,
	calculateRelevanceScore,
	enrichFindingsWithRelevance,
	MIN_QUALITY_THRESHOLD,
} from "../../utils/validation.js";

const logger = new Logger({ context: "QualityGate" });

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum window expansion level */
const MAX_WINDOW_LEVEL: ValidationWindowLevel = 3;

// =============================================================================
// QUALITY GATE NODE
// =============================================================================

/** Low relevance threshold - trigger scope check if below this */
const LOW_RELEVANCE_THRESHOLD = 30;

/**
 * Quality Gate node - validates gathered findings before Detective.
 *
 * Responsibilities:
 * 1. Calculate overall data quality score
 * 2. Calculate relevance score against incident context
 * 3. Check cross-correlation between findings
 * 4. Decide: proceed, expand window, or proceed with warning
 * 5. Flag scope issues if findings have low relevance
 */
export async function qualityGateNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	const currentWindowLevel = state.validationWindowLevel || 1;

	logger.info("Quality gate checking findings", {
		investigationId: state.investigationId,
		findingsCount: state.findings.length,
		currentWindowLevel,
	});

	// If no findings at all, this is a problem
	if (state.findings.length === 0) {
		logger.warn("No findings gathered, proceeding with warning");
		return {
			dataQuality: {
				...state.dataQuality,
				gathered: 0,
				relevance: 0,
			},
			dataQualityWarning:
				"No data gathered - investigation may be inconclusive",
			phase: "analyzing" as SupervisorPhase,
		};
	}

	// Enrich findings with relevance scores based on incident context
	const enrichedFindings = enrichFindingsWithRelevance(
		state.findings,
		state.incident,
	);

	// Calculate quality score
	const qualityScore = calculateDataQualityScore(
		enrichedFindings,
		state.incident,
	);

	// Calculate relevance score
	const relevanceScore = calculateRelevanceScore(
		enrichedFindings,
		state.incident,
	);

	// Check cross-correlation
	const correlations = checkCrossCorrelation(enrichedFindings);

	logger.info("Quality assessment complete", {
		qualityScore,
		relevanceScore,
		correlations,
		threshold: MIN_QUALITY_THRESHOLD,
		currentWindowLevel,
	});

	// Check for low relevance - may indicate scope drift
	const hasLowRelevance = relevanceScore < LOW_RELEVANCE_THRESHOLD;
	let scopeWarning: string | undefined;
	let shouldCheckScope = false;

	if (hasLowRelevance && qualityScore >= MIN_QUALITY_THRESHOLD) {
		// High quantity but low relevance - scope may have drifted
		logger.warn("High quantity but low relevance findings", {
			qualityScore,
			relevanceScore,
		});
		scopeWarning = "Findings have low relevance to incident. Consider verifying scope alignment.";
		shouldCheckScope = true;
	}

	// Decision logic - consider both quality AND relevance
	if (meetsQualityThreshold(qualityScore, MIN_QUALITY_THRESHOLD)) {
		// Quality is good, proceed to Detective
		logger.info("Quality threshold met, proceeding to Detective", {
			relevanceScore,
			scopeWarning: !!scopeWarning,
		});
		return {
			findings: enrichedFindings, // Update findings with relevance scores
			dataQuality: {
				...state.dataQuality,
				gathered: qualityScore,
				relevance: relevanceScore,
				correlations,
			},
			dataQualityWarning: scopeWarning,
			shouldCheckScope,
			phase: "analyzing" as SupervisorPhase,
		};
	}

	// Quality is below threshold
	if (currentWindowLevel < MAX_WINDOW_LEVEL) {
		// Expand window and re-gather
		const newWindowLevel = (currentWindowLevel + 1) as ValidationWindowLevel;
		logger.info("Quality below threshold, expanding window", {
			qualityScore,
			relevanceScore,
			currentWindowLevel,
			newWindowLevel,
		});

		return {
			validationWindowLevel: newWindowLevel,
			phase: "gathering" as SupervisorPhase,
			// Note: Gatherers will check windowLevel and use expanded windows
			// Todo status is reset by returning to gathering phase
			dataQuality: {
				...state.dataQuality,
				gathered: qualityScore,
				relevance: relevanceScore,
				correlations,
			},
		};
	}

	// At max window level, proceed with warning
	logger.warn("Quality below threshold at max window, proceeding with warning", {
		qualityScore,
		relevanceScore,
		currentWindowLevel,
	});

	// Combine warnings if both quality and relevance are low
	const combinedWarning = scopeWarning
		? `${scopeWarning} Also: proceeding with low data quality.`
		: "Proceeding with low data quality - investigation may be inconclusive";

	return {
		findings: enrichedFindings, // Update findings with relevance scores
		dataQuality: {
			...state.dataQuality,
			gathered: qualityScore,
			relevance: relevanceScore,
			correlations,
		},
		dataQualityWarning: combinedWarning,
		shouldCheckScope: shouldCheckScope || hasLowRelevance,
		phase: "analyzing" as SupervisorPhase,
	};
}

// =============================================================================
// ROUTING FUNCTION
// =============================================================================

/**
 * Route after quality gate.
 * Returns the next node to execute.
 */
export function qualityGateRoute(state: InvestigationState): string {
	// If phase is "gathering", we're re-running gatherers with expanded window
	if (state.phase === "gathering") {
		// Route back to supervisor which will dispatch to gatherers
		return "supervisor";
	}

	// Proceed directly to detective for analysis
	return "detective";
}
