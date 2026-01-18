/**
 * LangSmith Evaluator Adapters
 *
 * Adapts existing evaluators to LangSmith's evaluator function signature.
 * These wrap our rule-based evaluators to work with LangSmith's evaluate() function.
 */

import type { Run, Example } from "langsmith/schemas";
import {
	evaluateTrajectory,
	type TrajectoryExpectation,
} from "../../evaluators/trajectory.evaluator.js";
import {
	evaluateHypothesis,
	type HypothesisExpectation,
} from "../../evaluators/hypothesis.evaluator.js";
import {
	evaluateRecommendation,
	type RecommendationExpectation,
} from "../../evaluators/recommendation.evaluator.js";

// =============================================================================
// TYPES
// =============================================================================

export interface LangSmithEvaluationResult {
	key: string;
	score: number;
	comment?: string;
}

export type LangSmithEvaluator = (
	run: Run,
	example?: Example,
) => Promise<LangSmithEvaluationResult> | LangSmithEvaluationResult;

// =============================================================================
// TRAJECTORY EVALUATORS
// =============================================================================

/**
 * LangSmith-compatible trajectory evaluator
 * Uses the existing trajectory evaluator internally
 */
export function createTrajectoryEvaluator(
	expectation: TrajectoryExpectation,
): LangSmithEvaluator {
	return async (run: Run, example?: Example): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const trajectory = (outputs?.toolExecutions as Array<{ toolName: string }>) || [];

		// Convert to expected format if needed
		const trajectoryForEval = trajectory.map((t) => ({
			toolName: t.toolName,
			toolCategory: "unknown",
			arguments: {},
			result: {},
			status: "success" as const,
		}));

		const result = evaluateTrajectory(trajectoryForEval, expectation);

		return {
			key: "trajectory",
			score: result.metrics.f1,
			comment: result.passed
				? "All required tools called correctly"
				: `Missing: ${result.details.missingTools.join(", ")}`,
		};
	};
}

/**
 * Evaluator that checks if required tools were called
 */
export function createRequiredToolsEvaluator(
	requiredTools: string[],
): LangSmithEvaluator {
	return async (run: Run): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const trajectory = (outputs?.toolExecutions as Array<{ toolName: string }>) || [];
		const calledTools = new Set(trajectory.map((t) => t.toolName));

		const missing = requiredTools.filter((tool) => !calledTools.has(tool));
		const score = 1 - missing.length / requiredTools.length;

		return {
			key: "required_tools",
			score,
			comment:
				missing.length === 0
					? "All required tools called"
					: `Missing: ${missing.join(", ")}`,
		};
	};
}

/**
 * Evaluator that checks no forbidden tools were called
 */
export function createForbiddenToolsEvaluator(
	forbiddenTools: string[],
): LangSmithEvaluator {
	return async (run: Run): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const trajectory = (outputs?.toolExecutions as Array<{ toolName: string }>) || [];
		const calledTools = new Set(trajectory.map((t) => t.toolName));

		const called = forbiddenTools.filter((tool) => calledTools.has(tool));
		const score = called.length === 0 ? 1 : 0;

		return {
			key: "forbidden_tools",
			score,
			comment:
				called.length === 0
					? "No forbidden tools called"
					: `Forbidden tools called: ${called.join(", ")}`,
		};
	};
}

// =============================================================================
// HYPOTHESIS EVALUATORS
// =============================================================================

/**
 * LangSmith-compatible hypothesis evaluator
 */
export function createHypothesisEvaluator(
	expectation: HypothesisExpectation = {},
): LangSmithEvaluator {
	return async (run: Run, example?: Example): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const hypothesis = outputs?.hypothesis as {
			claim: string;
			confidence: number;
			category?: string;
			evidence?: string[];
		} | undefined;

		if (!hypothesis) {
			return {
				key: "hypothesis",
				score: 0,
				comment: "No hypothesis generated",
			};
		}

		// Get expected category from example if not in expectation
		const expectedCategory =
			expectation.expectedCategory ||
			(example?.outputs as Record<string, unknown> | undefined)?.expectedCategory as string | undefined;

		const result = evaluateHypothesis(
			{
				claim: hypothesis.claim,
				confidence: hypothesis.confidence,
				category: hypothesis.category as "code" | "config" | "infrastructure" | "external" | "unknown" | undefined,
				evidence: hypothesis.evidence || [],
				timestamp: new Date().toISOString(),
			},
			{
				...expectation,
				expectedCategory: expectedCategory as "code" | "config" | "infrastructure" | "external" | "unknown" | undefined,
			},
		);

		return {
			key: "hypothesis",
			score: result.score / 100,
			comment: result.feedback.join("; "),
		};
	};
}

/**
 * LangSmith-compatible category accuracy evaluator
 */
export function createCategoryEvaluator(
	expectedCategory?: string,
): LangSmithEvaluator {
	return async (run: Run, example?: Example): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const category = outputs?.rootCauseCategory as string | undefined;

		// Get expected category from example if not provided
		const expected =
			expectedCategory ||
			(example?.outputs as Record<string, unknown> | undefined)?.expectedCategory as string | undefined;

		if (!expected) {
			return {
				key: "category_accuracy",
				score: category ? 0.5 : 0,
				comment: "No expected category to compare against",
			};
		}

		const isCorrect = category === expected;

		return {
			key: "category_accuracy",
			score: isCorrect ? 1.0 : 0.0,
			comment: isCorrect
				? `Correct: ${category}`
				: `Expected ${expected}, got ${category || "none"}`,
		};
	};
}

/**
 * LangSmith-compatible confidence evaluator
 */
export function createConfidenceEvaluator(
	minimumConfidence?: number,
): LangSmithEvaluator {
	return async (run: Run, example?: Example): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const confidence = (outputs?.confidence as number) ?? 0;

		// Get minimum confidence from example if not provided
		const threshold =
			minimumConfidence ||
			(example?.outputs as Record<string, unknown> | undefined)?.minimumConfidence as number ||
			70;

		const passed = confidence >= threshold;

		return {
			key: "confidence",
			score: Math.min(1.0, confidence / 100),
			comment: passed
				? `Confidence ${confidence}% meets threshold ${threshold}%`
				: `Confidence ${confidence}% below threshold ${threshold}%`,
		};
	};
}

/**
 * Evaluator that checks if confidence meets the threshold
 */
export function createConfidenceThresholdEvaluator(
	minimumConfidence?: number,
): LangSmithEvaluator {
	return async (run: Run, example?: Example): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const confidence = (outputs?.confidence as number) ?? 0;

		const threshold =
			minimumConfidence ||
			(example?.outputs as Record<string, unknown> | undefined)?.minimumConfidence as number ||
			70;

		const passed = confidence >= threshold;

		return {
			key: "confidence_threshold",
			score: passed ? 1.0 : 0.0,
			comment: passed
				? `Confidence ${confidence}% meets threshold ${threshold}%`
				: `Confidence ${confidence}% below threshold ${threshold}%`,
		};
	};
}

// =============================================================================
// RECOMMENDATION EVALUATORS
// =============================================================================

/**
 * LangSmith-compatible recommendation evaluator
 */
export function createRecommendationEvaluator(
	expectation: RecommendationExpectation = {},
): LangSmithEvaluator {
	return async (run: Run): Promise<LangSmithEvaluationResult> => {
		const outputs = run.outputs as Record<string, unknown> | undefined;
		const recommendations = outputs?.recommendations as Array<{
			title: string;
			description?: string;
			category: string;
			priority: string;
			urgency: string;
			actionable?: boolean;
			codeChanges?: Array<{
				filePath?: string;
				searchBlock?: string;
				replaceBlock?: string;
				testCase?: string;
			}>;
		}> | undefined;

		if (!recommendations || recommendations.length === 0) {
			return {
				key: "recommendation",
				score: 0,
				comment: "No recommendations generated",
			};
		}

		// Evaluate the first/primary recommendation
		const rec = recommendations[0];
		const result = evaluateRecommendation(
			{
				title: rec.title,
				description: rec.description,
				category: rec.category as "code_fix" | "config_change" | "rollback" | "monitoring" | "investigation",
				priority: rec.priority as "critical" | "high" | "medium" | "low",
				urgency: rec.urgency as "immediate" | "short_term" | "long_term",
				actionable: rec.actionable ?? true,
				codeChanges: rec.codeChanges,
			},
			expectation,
		);

		return {
			key: "recommendation",
			score: result.score / 100,
			comment: result.feedback.join("; "),
		};
	};
}

// =============================================================================
// COMPOSITE EVALUATORS
// =============================================================================

/**
 * Create a composite evaluator that runs multiple evaluators
 */
export function createCompositeEvaluator(
	evaluators: LangSmithEvaluator[],
): LangSmithEvaluator {
	return async (run: Run, example?: Example): Promise<LangSmithEvaluationResult> => {
		const results = await Promise.all(
			evaluators.map((evaluator) => evaluator(run, example)),
		);

		const avgScore =
			results.reduce((sum, r) => sum + r.score, 0) / results.length;
		const comments = results.map((r) => `${r.key}: ${r.comment}`).join(" | ");

		return {
			key: "composite",
			score: avgScore,
			comment: comments,
		};
	};
}

/**
 * Create a standard investigation evaluator suite
 */
export function createInvestigationEvaluators(
	options: {
		expectedCategory?: string;
		minimumConfidence?: number;
		requiredTools?: string[];
		forbiddenTools?: string[];
	} = {},
): LangSmithEvaluator[] {
	const evaluators: LangSmithEvaluator[] = [
		createCategoryEvaluator(options.expectedCategory),
		createConfidenceEvaluator(options.minimumConfidence),
		createConfidenceThresholdEvaluator(options.minimumConfidence),
	];

	if (options.requiredTools && options.requiredTools.length > 0) {
		evaluators.push(createRequiredToolsEvaluator(options.requiredTools));
	}

	if (options.forbiddenTools && options.forbiddenTools.length > 0) {
		evaluators.push(createForbiddenToolsEvaluator(options.forbiddenTools));
	}

	return evaluators;
}
