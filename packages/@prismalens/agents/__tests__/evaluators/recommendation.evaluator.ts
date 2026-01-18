/**
 * Recommendation Evaluator
 *
 * Evaluators for assessing recommendation quality and actionability.
 */

import type { Recommendation, CodeChange } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

export interface RecommendationExpectation {
	/** Expected category */
	expectedCategory?: "code_fix" | "config_change" | "rollback" | "monitoring" | "investigation";
	/** Expected priority level */
	expectedPriority?: "critical" | "high" | "medium" | "low";
	/** Whether code changes are expected */
	expectCodeChanges?: boolean;
	/** Keywords that should appear in title/description */
	expectedKeywords?: string[];
}

export interface RecommendationEvaluationResult {
	/** Overall score (0-100) */
	score: number;
	/** Individual dimension scores */
	dimensions: {
		/** Is the title clear and actionable? (0-20) */
		titleClarity: number;
		/** Is the description detailed enough? (0-20) */
		descriptionDepth: number;
		/** Are priority and urgency appropriate? (0-20) */
		priorityAppropriate: number;
		/** If code_fix, are code changes present and valid? (0-25) */
		codeChangesValid: number;
		/** Is a test case included for code changes? (0-15) */
		testCaseIncluded: number;
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
 * Evaluate title clarity (0-20 points)
 */
export function evaluateTitleClarity(recommendation: Recommendation): {
	score: number;
	feedback: string;
} {
	const title = recommendation.title;

	// Check length
	if (title.length < 10) {
		return { score: 5, feedback: "Title too short to be actionable" };
	}

	if (title.length > 100) {
		return { score: 10, feedback: "Title is too long, should be more concise" };
	}

	// Check for action verbs
	const actionVerbs = [
		"fix",
		"add",
		"update",
		"remove",
		"change",
		"set",
		"configure",
		"rollback",
		"revert",
		"enable",
		"disable",
		"implement",
		"refactor",
	];
	const titleLower = title.toLowerCase();
	const hasActionVerb = actionVerbs.some((verb) => titleLower.includes(verb));

	if (!hasActionVerb) {
		return { score: 12, feedback: "Title lacks clear action verb" };
	}

	// Check for specificity
	const hasSpecificTarget = /\w+Handler|\w+Service|\w+\.ts|\w+\.js|[A-Z_]+/.test(title);
	if (hasSpecificTarget) {
		return { score: 20, feedback: "Clear, actionable title with specific target" };
	}

	return { score: 16, feedback: "Title has action verb but could be more specific" };
}

/**
 * Evaluate description depth (0-20 points)
 */
export function evaluateDescriptionDepth(recommendation: Recommendation): {
	score: number;
	feedback: string;
} {
	const description = recommendation.description;

	if (!description) {
		return { score: 5, feedback: "No description provided" };
	}

	if (description.length < 20) {
		return { score: 8, feedback: "Description too brief" };
	}

	if (description.length < 50) {
		return { score: 12, feedback: "Description could be more detailed" };
	}

	// Check for explanation of why
	const explanatoryWords = ["because", "due to", "since", "as a result", "caused by", "to prevent", "will fix"];
	const hasExplanation = explanatoryWords.some((word) =>
		description.toLowerCase().includes(word),
	);

	if (description.length >= 100 && hasExplanation) {
		return { score: 20, feedback: "Detailed description with explanation" };
	}

	if (description.length >= 50) {
		return { score: 15, feedback: "Adequate description" };
	}

	return { score: 12, feedback: "Description present but could include more context" };
}

/**
 * Evaluate priority appropriateness (0-20 points)
 */
export function evaluatePriorityAppropriate(
	recommendation: Recommendation,
	expectedPriority?: string,
): { score: number; feedback: string } {
	const { priority, urgency, category } = recommendation;

	// Check for consistency between priority and urgency
	const priorityUrgencyConsistent =
		(priority === "critical" && urgency === "immediate") ||
		(priority === "high" && ["immediate", "short_term"].includes(urgency)) ||
		(priority === "medium" && ["short_term", "long_term"].includes(urgency)) ||
		(priority === "low" && urgency === "long_term");

	// Check category-priority alignment
	const categoryPriorityAligned =
		(category === "rollback" && ["critical", "high"].includes(priority)) ||
		(category === "monitoring" && ["medium", "low"].includes(priority)) ||
		(category === "investigation" && ["medium", "low"].includes(priority)) ||
		["code_fix", "config_change"].includes(category);

	let score = 10;
	const feedback: string[] = [];

	if (priorityUrgencyConsistent) {
		score += 5;
		feedback.push("Priority and urgency are consistent");
	} else {
		feedback.push("Priority/urgency mismatch");
	}

	if (categoryPriorityAligned) {
		score += 5;
		feedback.push("Priority appropriate for category");
	} else {
		feedback.push("Priority may not match category");
	}

	// Check against expected priority
	if (expectedPriority && priority !== expectedPriority) {
		score = Math.max(0, score - 10);
		feedback.push(`Expected priority ${expectedPriority}, got ${priority}`);
	}

	return { score, feedback: feedback.join("; ") };
}

/**
 * Evaluate code changes validity (0-25 points)
 */
export function evaluateCodeChangesValid(
	recommendation: Recommendation,
	expectCodeChanges?: boolean,
): { score: number; feedback: string } {
	const { category, codeChanges } = recommendation;
	const isCodeFix = category === "code_fix";

	// If not a code fix, code changes are optional
	if (!isCodeFix && !expectCodeChanges) {
		return codeChanges && codeChanges.length > 0
			? { score: 20, feedback: "Code changes provided even though not required" }
			: { score: 25, feedback: "No code changes needed for this category" };
	}

	// For code_fix category, code changes are expected
	if (isCodeFix && (!codeChanges || codeChanges.length === 0)) {
		return { score: 5, feedback: "Code fix category but no code changes provided" };
	}

	if (!codeChanges || codeChanges.length === 0) {
		return expectCodeChanges
			? { score: 0, feedback: "Expected code changes but none provided" }
			: { score: 25, feedback: "No code changes (not required)" };
	}

	// Evaluate code change quality
	let score = 10;
	const feedback: string[] = [];

	for (const change of codeChanges) {
		// Check file path
		if (change.filePath && change.filePath.includes("/")) {
			score += 3;
		}

		// Check search block
		if (change.searchBlock && change.searchBlock.length >= 10) {
			score += 3;
		} else {
			feedback.push("Search block too short or missing");
		}

		// Check replace block
		if (change.replaceBlock && change.replaceBlock.length >= 10) {
			score += 3;
		} else {
			feedback.push("Replace block too short or missing");
		}

		// Check they're different
		if (change.searchBlock !== change.replaceBlock) {
			score += 3;
		} else {
			feedback.push("Search and replace blocks are identical");
		}
	}

	return {
		score: Math.min(25, score),
		feedback: feedback.length > 0 ? feedback.join("; ") : "Valid code changes",
	};
}

/**
 * Evaluate test case inclusion (0-15 points)
 */
export function evaluateTestCaseIncluded(recommendation: Recommendation): {
	score: number;
	feedback: string;
} {
	const { codeChanges, category } = recommendation;

	// Test cases only relevant for code fixes
	if (category !== "code_fix") {
		return { score: 15, feedback: "Test case not applicable for this category" };
	}

	if (!codeChanges || codeChanges.length === 0) {
		return { score: 0, feedback: "No code changes to test" };
	}

	const hasTestCases = codeChanges.every(
		(change) => change.testCase && change.testCase.length >= 10,
	);
	const hasPartialTestCases = codeChanges.some(
		(change) => change.testCase && change.testCase.length >= 10,
	);

	if (hasTestCases) {
		// Check test case quality
		const testHasCommand = codeChanges.some((change) =>
			/npm|yarn|pnpm|jest|vitest|pytest|go test/.test(change.testCase),
		);
		if (testHasCommand) {
			return { score: 15, feedback: "All code changes have executable test cases" };
		}
		return { score: 12, feedback: "Test cases provided but could be more specific" };
	}

	if (hasPartialTestCases) {
		return { score: 8, feedback: "Some code changes missing test cases" };
	}

	return { score: 3, feedback: "No test cases provided for code changes" };
}

// =============================================================================
// MAIN EVALUATOR
// =============================================================================

/**
 * Comprehensive recommendation evaluation
 */
export function evaluateRecommendation(
	recommendation: Recommendation,
	expectation: RecommendationExpectation = {},
): RecommendationEvaluationResult {
	const feedback: string[] = [];

	// Evaluate each dimension
	const titleResult = evaluateTitleClarity(recommendation);
	feedback.push(`Title: ${titleResult.feedback}`);

	const descriptionResult = evaluateDescriptionDepth(recommendation);
	feedback.push(`Description: ${descriptionResult.feedback}`);

	const priorityResult = evaluatePriorityAppropriate(
		recommendation,
		expectation.expectedPriority,
	);
	feedback.push(`Priority: ${priorityResult.feedback}`);

	const codeChangesResult = evaluateCodeChangesValid(
		recommendation,
		expectation.expectCodeChanges,
	);
	feedback.push(`Code Changes: ${codeChangesResult.feedback}`);

	const testCaseResult = evaluateTestCaseIncluded(recommendation);
	feedback.push(`Test Case: ${testCaseResult.feedback}`);

	// Check expected category
	if (expectation.expectedCategory && recommendation.category !== expectation.expectedCategory) {
		feedback.push(
			`Category: Expected ${expectation.expectedCategory}, got ${recommendation.category}`,
		);
	}

	// Check expected keywords
	if (expectation.expectedKeywords && expectation.expectedKeywords.length > 0) {
		const text = `${recommendation.title} ${recommendation.description ?? ""}`.toLowerCase();
		const foundKeywords = expectation.expectedKeywords.filter((kw) =>
			text.includes(kw.toLowerCase()),
		);
		feedback.push(
			`Keywords: Found ${foundKeywords.length}/${expectation.expectedKeywords.length}`,
		);
	}

	// Calculate total score
	const score =
		titleResult.score +
		descriptionResult.score +
		priorityResult.score +
		codeChangesResult.score +
		testCaseResult.score;

	// Determine pass/fail (70% threshold)
	const passed = score >= 70;

	return {
		score,
		dimensions: {
			titleClarity: titleResult.score,
			descriptionDepth: descriptionResult.score,
			priorityAppropriate: priorityResult.score,
			codeChangesValid: codeChangesResult.score,
			testCaseIncluded: testCaseResult.score,
		},
		feedback,
		passed,
	};
}

// =============================================================================
// BATCH EVALUATION
// =============================================================================

/**
 * Evaluate multiple recommendations
 */
export function evaluateRecommendations(
	recommendations: Recommendation[],
	expectation: RecommendationExpectation = {},
): {
	averageScore: number;
	passRate: number;
	results: Array<{ recommendation: Recommendation; result: RecommendationEvaluationResult }>;
} {
	if (recommendations.length === 0) {
		return { averageScore: 0, passRate: 0, results: [] };
	}

	const results = recommendations.map((recommendation) => ({
		recommendation,
		result: evaluateRecommendation(recommendation, expectation),
	}));

	const averageScore =
		results.reduce((sum, r) => sum + r.result.score, 0) / results.length;
	const passRate =
		results.filter((r) => r.result.passed).length / results.length;

	return { averageScore, passRate, results };
}

/**
 * Create a human-readable summary
 */
export function recommendationToSummary(
	result: RecommendationEvaluationResult,
	recommendation: Recommendation,
): string {
	const lines: string[] = [];

	lines.push(`Recommendation Evaluation: ${result.passed ? "PASSED" : "FAILED"}`);
	lines.push(`Score: ${result.score}/100`);
	lines.push("");
	lines.push(`Title: "${recommendation.title}"`);
	lines.push(`Category: ${recommendation.category}`);
	lines.push(`Priority: ${recommendation.priority}`);
	lines.push(`Urgency: ${recommendation.urgency}`);
	lines.push("");
	lines.push("Dimension Scores:");
	lines.push(`  Title Clarity: ${result.dimensions.titleClarity}/20`);
	lines.push(`  Description Depth: ${result.dimensions.descriptionDepth}/20`);
	lines.push(`  Priority Appropriate: ${result.dimensions.priorityAppropriate}/20`);
	lines.push(`  Code Changes Valid: ${result.dimensions.codeChangesValid}/25`);
	lines.push(`  Test Case Included: ${result.dimensions.testCaseIncluded}/15`);
	lines.push("");
	lines.push("Feedback:");
	result.feedback.forEach((f) => lines.push(`  - ${f}`));

	return lines.join("\n");
}
