/**
 * Hypothesis Evaluator
 *
 * LLM-as-judge and rule-based evaluators for hypothesis quality.
 * Assesses evidence support, specificity, confidence calibration, and category accuracy.
 */

import type { Hypothesis } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

export interface HypothesisExpectation {
	/** Expected root cause category */
	expectedCategory?: "code" | "config" | "infrastructure" | "external" | "unknown";
	/** Expected minimum confidence for a correct hypothesis */
	minimumConfidence?: number;
	/** Keywords that should appear in the claim */
	expectedKeywords?: string[];
	/** Whether the hypothesis should be correct (for calibration) */
	isCorrect?: boolean;
}

export interface HypothesisEvaluationResult {
	/** Overall score (0-100) */
	score: number;
	/** Individual dimension scores */
	dimensions: {
		/** How well is the claim supported by evidence? (0-40) */
		evidenceSupport: number;
		/** How specific is the claim? (0-20) */
		specificity: number;
		/** Is confidence appropriate for the evidence? (0-20) */
		confidenceCalibration: number;
		/** Is the category correct? (0-20) */
		categoryAccuracy: number;
	};
	/** Detailed feedback */
	feedback: string[];
	/** Pass/fail based on threshold */
	passed: boolean;
}

// =============================================================================
// RULE-BASED EVALUATORS
// =============================================================================

/**
 * Evaluate evidence support (0-40 points)
 * - 40 points: 3+ strong pieces of evidence
 * - 30 points: 2 pieces of evidence
 * - 20 points: 1 piece of evidence
 * - 0 points: No evidence
 */
export function evaluateEvidenceSupport(hypothesis: Hypothesis): {
	score: number;
	feedback: string;
} {
	const evidenceCount = hypothesis.evidence?.length ?? 0;

	if (evidenceCount >= 3) {
		// Check evidence quality (length as proxy)
		const avgLength =
			hypothesis.evidence.reduce((sum, e) => sum + e.length, 0) / evidenceCount;
		if (avgLength > 50) {
			return { score: 40, feedback: "Strong evidence with detailed explanations" };
		}
		return { score: 35, feedback: "Multiple pieces of evidence provided" };
	}

	if (evidenceCount === 2) {
		return { score: 30, feedback: "Two pieces of evidence provided" };
	}

	if (evidenceCount === 1) {
		return { score: 20, feedback: "Only one piece of evidence - consider adding more" };
	}

	return { score: 0, feedback: "No evidence provided" };
}

/**
 * Evaluate specificity (0-20 points)
 * - 20 points: Claim references specific code/config/resource
 * - 15 points: Claim identifies a category and component
 * - 10 points: Generic claim with some detail
 * - 5 points: Very generic claim
 */
export function evaluateSpecificity(hypothesis: Hypothesis): {
	score: number;
	feedback: string;
} {
	const claim = hypothesis.claim.toLowerCase();

	// Check for specific identifiers
	const hasFileReference = /\.(ts|js|py|go|java|rb|rs)/.test(claim);
	const hasLineNumber = /line \d+|:\d+/.test(claim);
	const hasClassName = /class\s+\w+|function\s+\w+|\w+Handler|\w+Service/.test(claim);
	const hasConfigKey = /\w+_\w+|[A-Z_]{3,}/.test(hypothesis.claim);

	let specificity = 0;
	const details: string[] = [];

	if (hasFileReference) {
		specificity += 5;
		details.push("References specific file");
	}
	if (hasLineNumber) {
		specificity += 5;
		details.push("Includes line number");
	}
	if (hasClassName) {
		specificity += 5;
		details.push("Names specific component");
	}
	if (hasConfigKey) {
		specificity += 5;
		details.push("References specific config");
	}

	// Ensure minimum score if claim has reasonable length
	if (specificity === 0 && hypothesis.claim.length > 30) {
		specificity = 10;
	}

	const score = Math.min(20, specificity);
	const feedback =
		details.length > 0 ? details.join("; ") : "Claim could be more specific";

	return { score, feedback };
}

/**
 * Evaluate confidence calibration (0-20 points)
 * - If hypothesis is correct: higher confidence = better
 * - If hypothesis is incorrect: lower confidence = better
 * - Without ground truth: penalize extremes without strong evidence
 */
export function evaluateConfidenceCalibration(
	hypothesis: Hypothesis,
	isCorrect?: boolean,
): { score: number; feedback: string } {
	const confidence = hypothesis.confidence;
	const evidenceCount = hypothesis.evidence?.length ?? 0;

	// If we know correctness, evaluate calibration
	if (isCorrect !== undefined) {
		if (isCorrect) {
			// Correct hypothesis: higher confidence is better
			if (confidence >= 80) return { score: 20, feedback: "Well-calibrated high confidence for correct hypothesis" };
			if (confidence >= 60) return { score: 15, feedback: "Moderate confidence for correct hypothesis" };
			return { score: 10, feedback: "Low confidence despite being correct" };
		} else {
			// Incorrect hypothesis: lower confidence is better (shows appropriate uncertainty)
			if (confidence <= 50) return { score: 20, feedback: "Appropriately low confidence for incorrect hypothesis" };
			if (confidence <= 70) return { score: 10, feedback: "Moderate confidence for incorrect hypothesis" };
			return { score: 0, feedback: "Overconfident despite being incorrect" };
		}
	}

	// Without ground truth, check if confidence matches evidence
	const expectedConfidence = Math.min(95, 40 + evidenceCount * 15);
	const diff = Math.abs(confidence - expectedConfidence);

	if (diff <= 10) return { score: 20, feedback: "Confidence aligns with evidence level" };
	if (diff <= 20) return { score: 15, feedback: "Confidence reasonably matches evidence" };
	if (diff <= 30) return { score: 10, feedback: "Confidence could better match evidence level" };
	return { score: 5, feedback: "Confidence significantly misaligned with evidence" };
}

/**
 * Evaluate category accuracy (0-20 points)
 */
export function evaluateCategoryAccuracy(
	hypothesis: Hypothesis,
	expectedCategory?: string,
): { score: number; feedback: string } {
	if (!expectedCategory) {
		// If no expected category, just check that one is provided
		return hypothesis.category
			? { score: 15, feedback: "Category provided (cannot verify accuracy)" }
			: { score: 0, feedback: "No category specified" };
	}

	if (hypothesis.category === expectedCategory) {
		return { score: 20, feedback: "Correct category identified" };
	}

	// Partial credit for related categories
	const relatedCategories: Record<string, string[]> = {
		code: ["config"], // Code issues sometimes manifest as config issues
		config: ["infrastructure"], // Config can affect infrastructure
		infrastructure: ["external"], // Infra issues can look like external
	};

	const related = relatedCategories[expectedCategory] ?? [];
	if (hypothesis.category && related.includes(hypothesis.category)) {
		return { score: 10, feedback: "Related category identified (not exact match)" };
	}

	return { score: 0, feedback: `Incorrect category: expected ${expectedCategory}, got ${hypothesis.category}` };
}

// =============================================================================
// MAIN EVALUATOR
// =============================================================================

/**
 * Comprehensive hypothesis evaluation
 */
export function evaluateHypothesis(
	hypothesis: Hypothesis,
	expectation: HypothesisExpectation = {},
): HypothesisEvaluationResult {
	const feedback: string[] = [];

	// Evaluate each dimension
	const evidenceResult = evaluateEvidenceSupport(hypothesis);
	feedback.push(`Evidence: ${evidenceResult.feedback}`);

	const specificityResult = evaluateSpecificity(hypothesis);
	feedback.push(`Specificity: ${specificityResult.feedback}`);

	const calibrationResult = evaluateConfidenceCalibration(
		hypothesis,
		expectation.isCorrect,
	);
	feedback.push(`Calibration: ${calibrationResult.feedback}`);

	const categoryResult = evaluateCategoryAccuracy(
		hypothesis,
		expectation.expectedCategory,
	);
	feedback.push(`Category: ${categoryResult.feedback}`);

	// Check for expected keywords
	if (expectation.expectedKeywords && expectation.expectedKeywords.length > 0) {
		const claimLower = hypothesis.claim.toLowerCase();
		const foundKeywords = expectation.expectedKeywords.filter((kw) =>
			claimLower.includes(kw.toLowerCase()),
		);
		const keywordRatio = foundKeywords.length / expectation.expectedKeywords.length;
		feedback.push(
			`Keywords: Found ${foundKeywords.length}/${expectation.expectedKeywords.length} expected keywords`,
		);
	}

	// Calculate total score
	const score =
		evidenceResult.score +
		specificityResult.score +
		calibrationResult.score +
		categoryResult.score;

	// Determine pass/fail (70% threshold)
	const passed = score >= 70;

	return {
		score,
		dimensions: {
			evidenceSupport: evidenceResult.score,
			specificity: specificityResult.score,
			confidenceCalibration: calibrationResult.score,
			categoryAccuracy: categoryResult.score,
		},
		feedback,
		passed,
	};
}

// =============================================================================
// BATCH EVALUATION
// =============================================================================

/**
 * Evaluate multiple hypotheses and return the best one
 */
export function evaluateBestHypothesis(
	hypotheses: Hypothesis[],
	expectation: HypothesisExpectation = {},
): {
	bestHypothesis: Hypothesis | null;
	bestScore: number;
	allResults: Array<{ hypothesis: Hypothesis; result: HypothesisEvaluationResult }>;
} {
	if (hypotheses.length === 0) {
		return { bestHypothesis: null, bestScore: 0, allResults: [] };
	}

	const allResults = hypotheses.map((hypothesis) => ({
		hypothesis,
		result: evaluateHypothesis(hypothesis, expectation),
	}));

	// Sort by score descending
	allResults.sort((a, b) => b.result.score - a.result.score);

	return {
		bestHypothesis: allResults[0].hypothesis,
		bestScore: allResults[0].result.score,
		allResults,
	};
}

/**
 * Create a human-readable summary
 */
export function hypothesisToSummary(
	result: HypothesisEvaluationResult,
	hypothesis: Hypothesis,
): string {
	const lines: string[] = [];

	lines.push(`Hypothesis Evaluation: ${result.passed ? "PASSED" : "FAILED"}`);
	lines.push(`Score: ${result.score}/100`);
	lines.push("");
	lines.push(`Claim: "${hypothesis.claim.substring(0, 80)}${hypothesis.claim.length > 80 ? "..." : ""}"`);
	lines.push(`Confidence: ${hypothesis.confidence}%`);
	lines.push(`Category: ${hypothesis.category ?? "not specified"}`);
	lines.push("");
	lines.push("Dimension Scores:");
	lines.push(`  Evidence Support: ${result.dimensions.evidenceSupport}/40`);
	lines.push(`  Specificity: ${result.dimensions.specificity}/20`);
	lines.push(`  Confidence Calibration: ${result.dimensions.confidenceCalibration}/20`);
	lines.push(`  Category Accuracy: ${result.dimensions.categoryAccuracy}/20`);
	lines.push("");
	lines.push("Feedback:");
	result.feedback.forEach((f) => lines.push(`  - ${f}`));

	return lines.join("\n");
}
