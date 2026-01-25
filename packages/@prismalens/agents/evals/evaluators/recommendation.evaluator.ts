/**
 * Recommendation Quality Evaluator
 *
 * Evaluates the quality of fix recommendations.
 * Checks: actionability, completeness, risk assessment.
 */

import type { Recommendation } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

export interface RecommendationEvaluationResult {
	/** Overall score (0-100) */
	score: number;
	/** Individual check results */
	checks: {
		hasTitle: boolean;
		hasDescription: boolean;
		hasCategory: boolean;
		hasPriority: boolean;
		hasVerificationSteps: boolean;
		hasRiskAssessment: boolean;
		isActionable: boolean;
	};
	/** Detailed feedback */
	feedback: string[];
}

export interface RecommendationEvaluationOptions {
	/** Require verification steps */
	requireVerification?: boolean;
	/** Require risk assessment */
	requireRisk?: boolean;
	/** Minimum description length */
	minDescriptionLength?: number;
}

// =============================================================================
// EVALUATOR
// =============================================================================

/**
 * Evaluate a single recommendation.
 */
export function evaluateRecommendation(
	rec: Recommendation,
	options: RecommendationEvaluationOptions = {},
): RecommendationEvaluationResult {
	const {
		requireVerification = false,
		requireRisk = false,
		minDescriptionLength = 20,
	} = options;

	const feedback: string[] = [];

	// Check individual criteria
	const hasTitle = Boolean(rec.title && rec.title.length > 5);
	const hasDescription = Boolean(
		rec.description && rec.description.length >= minDescriptionLength,
	);
	const hasCategory = Boolean(rec.category);
	const hasPriority = Boolean(rec.priority);
	const hasVerificationSteps =
		Array.isArray(rec.verificationSteps) && rec.verificationSteps.length > 0;
	const hasRiskAssessment =
		typeof rec.riskScore === "number" ||
		Boolean(rec.approvalLevel);

	// Determine if actionable (has enough info to act on)
	const isActionable = hasTitle && hasDescription && (hasVerificationSteps || !requireVerification);

	// Generate feedback
	if (!hasTitle) {
		feedback.push("Recommendation title is missing or too short");
	}

	if (!hasDescription) {
		feedback.push(`Description is missing or too short (< ${minDescriptionLength} chars)`);
	}

	if (!hasCategory) {
		feedback.push("Category is missing");
	}

	if (!hasPriority) {
		feedback.push("Priority is missing");
	}

	if (requireVerification && !hasVerificationSteps) {
		feedback.push("Verification steps are required but missing");
	}

	if (requireRisk && !hasRiskAssessment) {
		feedback.push("Risk assessment is required but missing");
	}

	if (!isActionable) {
		feedback.push("Recommendation is not actionable - missing key information");
	}

	// Calculate score
	let score = 0;
	const weights = {
		title: 15,
		description: 25,
		category: 10,
		priority: 10,
		verification: 20,
		risk: 10,
		actionable: 10,
	};

	if (hasTitle) score += weights.title;
	if (hasDescription) score += weights.description;
	if (hasCategory) score += weights.category;
	if (hasPriority) score += weights.priority;
	if (hasVerificationSteps) score += weights.verification;
	if (hasRiskAssessment) score += weights.risk;
	if (isActionable) score += weights.actionable;

	return {
		score: Math.round(score),
		checks: {
			hasTitle,
			hasDescription,
			hasCategory,
			hasPriority,
			hasVerificationSteps,
			hasRiskAssessment,
			isActionable,
		},
		feedback,
	};
}

/**
 * Evaluate multiple recommendations.
 */
export function evaluateRecommendations(
	recommendations: Recommendation[],
	options: RecommendationEvaluationOptions = {},
): {
	overallScore: number;
	results: RecommendationEvaluationResult[];
	actionableCount: number;
	hasHighPriority: boolean;
} {
	if (!recommendations || recommendations.length === 0) {
		return {
			overallScore: 0,
			results: [],
			actionableCount: 0,
			hasHighPriority: false,
		};
	}

	const results = recommendations.map((r) => evaluateRecommendation(r, options));
	const overallScore = Math.round(
		results.reduce((sum, r) => sum + r.score, 0) / results.length,
	);

	const actionableCount = results.filter((r) => r.checks.isActionable).length;
	const hasHighPriority = recommendations.some(
		(r) => r.priority === "high" || r.priority === "critical",
	);

	return {
		overallScore,
		results,
		actionableCount,
		hasHighPriority,
	};
}
