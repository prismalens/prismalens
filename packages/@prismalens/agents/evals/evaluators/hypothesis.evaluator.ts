/**
 * Hypothesis Quality Evaluator
 *
 * Evaluates the quality of hypotheses generated during investigation.
 * Checks: evidence quality, confidence calibration, category accuracy.
 */

import type { Hypothesis } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

export interface HypothesisEvaluationResult {
	/** Overall score (0-100) */
	score: number;
	/** Individual check results */
	checks: {
		hasValidClaim: boolean;
		hasEvidence: boolean;
		hasConfidence: boolean;
		hasCategory: boolean;
		confidenceInRange: boolean;
		evidenceCount: number;
	};
	/** Detailed feedback */
	feedback: string[];
}

export interface HypothesisEvaluationOptions {
	/** Expected category (if known) */
	expectedCategory?: string;
	/** Minimum required confidence */
	minConfidence?: number;
	/** Minimum required evidence items */
	minEvidence?: number;
}

// =============================================================================
// EVALUATOR
// =============================================================================

/**
 * Evaluate a single hypothesis for quality.
 */
export function evaluateHypothesis(
	hypothesis: Hypothesis,
	options: HypothesisEvaluationOptions = {},
): HypothesisEvaluationResult {
	const { expectedCategory, minConfidence = 0, minEvidence = 1 } = options;
	const feedback: string[] = [];

	// Check individual criteria
	const hasValidClaim = Boolean(hypothesis.claim && hypothesis.claim.length > 10);
	const hasEvidence = Array.isArray(hypothesis.evidence) && hypothesis.evidence.length > 0;
	const hasConfidence = typeof hypothesis.confidence === "number";
	const hasCategory = Boolean(hypothesis.category);
	const confidenceInRange =
		hasConfidence && hypothesis.confidence >= 0 && hypothesis.confidence <= 100;
	const evidenceCount = hypothesis.evidence?.length || 0;

	// Generate feedback
	if (!hasValidClaim) {
		feedback.push("Hypothesis claim is missing or too short");
	}

	if (!hasEvidence) {
		feedback.push("No evidence provided to support hypothesis");
	} else if (evidenceCount < minEvidence) {
		feedback.push(`Only ${evidenceCount} evidence items (expected >= ${minEvidence})`);
	}

	if (!hasConfidence) {
		feedback.push("Confidence score is missing");
	} else if (!confidenceInRange) {
		feedback.push(`Confidence ${hypothesis.confidence} is out of range [0-100]`);
	} else if (hypothesis.confidence < minConfidence) {
		feedback.push(`Confidence ${hypothesis.confidence} is below minimum ${minConfidence}`);
	}

	if (!hasCategory) {
		feedback.push("Category is missing");
	} else if (expectedCategory && hypothesis.category !== expectedCategory) {
		feedback.push(`Category mismatch: got "${hypothesis.category}", expected "${expectedCategory}"`);
	}

	// Calculate score
	let score = 0;
	const weights = {
		claim: 25,
		evidence: 25,
		confidence: 20,
		category: 15,
		evidenceQuantity: 15,
	};

	if (hasValidClaim) score += weights.claim;
	if (hasEvidence) score += weights.evidence;
	if (hasConfidence && confidenceInRange) score += weights.confidence;
	if (hasCategory) {
		if (expectedCategory && hypothesis.category === expectedCategory) {
			score += weights.category;
		} else if (!expectedCategory) {
			score += weights.category;
		}
	}
	if (evidenceCount >= minEvidence) {
		score += weights.evidenceQuantity;
	} else if (evidenceCount > 0) {
		score += (evidenceCount / minEvidence) * weights.evidenceQuantity;
	}

	return {
		score: Math.round(score),
		checks: {
			hasValidClaim,
			hasEvidence,
			hasConfidence,
			hasCategory,
			confidenceInRange,
			evidenceCount,
		},
		feedback,
	};
}

/**
 * Evaluate multiple hypotheses and return aggregate score.
 */
export function evaluateHypotheses(
	hypotheses: Hypothesis[],
	options: HypothesisEvaluationOptions = {},
): {
	overallScore: number;
	results: HypothesisEvaluationResult[];
	bestHypothesis: Hypothesis | null;
} {
	if (!hypotheses || hypotheses.length === 0) {
		return {
			overallScore: 0,
			results: [],
			bestHypothesis: null,
		};
	}

	const results = hypotheses.map((h) => evaluateHypothesis(h, options));
	const overallScore = Math.round(
		results.reduce((sum, r) => sum + r.score, 0) / results.length,
	);

	// Find best hypothesis by confidence
	const bestIndex = hypotheses.reduce(
		(best, h, i) => (h.confidence > (hypotheses[best]?.confidence || 0) ? i : best),
		0,
	);

	return {
		overallScore,
		results,
		bestHypothesis: hypotheses[bestIndex] || null,
	};
}
