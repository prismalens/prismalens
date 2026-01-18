/**
 * Trajectory Evaluator
 *
 * Rule-based evaluators for assessing agent tool usage trajectories.
 * Based on LangChain's "Evaluating Deep Agents" best practices.
 */

import type { ToolExecutionRecord } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TrajectoryExpectation {
	/** Tools that must appear in the trajectory (order doesn't matter) */
	requiredTools: string[];
	/** Tools that must appear in this specific order (subsequence) */
	orderedTools?: string[];
	/** Tools that should NOT appear */
	forbiddenTools?: string[];
	/** Maximum number of tool calls allowed */
	maxToolCalls?: number;
	/** Minimum number of tool calls expected */
	minToolCalls?: number;
}

export interface TrajectoryEvaluationResult {
	/** Overall pass/fail */
	passed: boolean;
	/** Individual metric scores */
	metrics: {
		/** Were all required tools called? */
		requiredToolsPresent: boolean;
		/** Were ordered tools called in correct sequence? */
		orderedToolsCorrect: boolean;
		/** Were any forbidden tools called? */
		noForbiddenTools: boolean;
		/** Is tool count within bounds? */
		toolCountValid: boolean;
		/** Precision: correct tools / total tools called */
		precision: number;
		/** Recall: correct tools called / required tools */
		recall: number;
		/** F1 score */
		f1: number;
		/** Efficiency: required tools / total tools */
		efficiency: number;
	};
	/** Detailed findings */
	details: {
		toolsCalled: string[];
		missingTools: string[];
		unexpectedTools: string[];
		forbiddenToolsCalled: string[];
		toolCallCount: number;
	};
}

// =============================================================================
// EVALUATOR FUNCTIONS
// =============================================================================

/**
 * Check if required tools are present in trajectory (order doesn't matter)
 */
export function evaluateRequiredTools(
	trajectory: ToolExecutionRecord[],
	requiredTools: string[],
): { present: boolean; missing: string[] } {
	const calledTools = new Set(trajectory.map((t) => t.toolName));
	const missing = requiredTools.filter((tool) => !calledTools.has(tool));
	return {
		present: missing.length === 0,
		missing,
	};
}

/**
 * Check if ordered tools appear in correct sequence (subsequence match)
 */
export function evaluateOrderedTools(
	trajectory: ToolExecutionRecord[],
	orderedTools: string[],
): boolean {
	if (!orderedTools || orderedTools.length === 0) {
		return true;
	}

	const calledTools = trajectory.map((t) => t.toolName);
	let orderIndex = 0;

	for (const tool of calledTools) {
		if (tool === orderedTools[orderIndex]) {
			orderIndex++;
			if (orderIndex === orderedTools.length) {
				return true;
			}
		}
	}

	return orderIndex === orderedTools.length;
}

/**
 * Check if any forbidden tools were called
 */
export function evaluateForbiddenTools(
	trajectory: ToolExecutionRecord[],
	forbiddenTools: string[],
): { valid: boolean; called: string[] } {
	if (!forbiddenTools || forbiddenTools.length === 0) {
		return { valid: true, called: [] };
	}

	const calledTools = new Set(trajectory.map((t) => t.toolName));
	const called = forbiddenTools.filter((tool) => calledTools.has(tool));

	return {
		valid: called.length === 0,
		called,
	};
}

/**
 * Calculate precision, recall, and F1 for tool selection
 */
export function calculateToolSelectionMetrics(
	trajectory: ToolExecutionRecord[],
	expectedTools: string[],
): { precision: number; recall: number; f1: number } {
	const calledTools = new Set(trajectory.map((t) => t.toolName));
	const expectedSet = new Set(expectedTools);

	const correctCalls = [...calledTools].filter((t) => expectedSet.has(t)).length;
	const totalCalled = calledTools.size;
	const totalExpected = expectedSet.size;

	const precision = totalCalled > 0 ? correctCalls / totalCalled : 0;
	const recall = totalExpected > 0 ? correctCalls / totalExpected : 0;
	const f1 =
		precision + recall > 0
			? (2 * precision * recall) / (precision + recall)
			: 0;

	return { precision, recall, f1 };
}

/**
 * Calculate efficiency (expected tools / total calls)
 */
export function calculateEfficiency(
	trajectory: ToolExecutionRecord[],
	expectedToolCount: number,
): number {
	if (trajectory.length === 0) {
		return expectedToolCount === 0 ? 1 : 0;
	}
	return Math.min(1, expectedToolCount / trajectory.length);
}

// =============================================================================
// MAIN EVALUATOR
// =============================================================================

/**
 * Comprehensive trajectory evaluation
 */
export function evaluateTrajectory(
	trajectory: ToolExecutionRecord[],
	expectation: TrajectoryExpectation,
): TrajectoryEvaluationResult {
	const calledTools = trajectory.map((t) => t.toolName);
	const calledToolsSet = new Set(calledTools);

	// Evaluate required tools
	const { present: requiredToolsPresent, missing: missingTools } =
		evaluateRequiredTools(trajectory, expectation.requiredTools);

	// Evaluate ordered tools
	const orderedToolsCorrect = evaluateOrderedTools(
		trajectory,
		expectation.orderedTools ?? [],
	);

	// Evaluate forbidden tools
	const { valid: noForbiddenTools, called: forbiddenToolsCalled } =
		evaluateForbiddenTools(trajectory, expectation.forbiddenTools ?? []);

	// Evaluate tool count
	const toolCountValid =
		(expectation.minToolCalls === undefined ||
			trajectory.length >= expectation.minToolCalls) &&
		(expectation.maxToolCalls === undefined ||
			trajectory.length <= expectation.maxToolCalls);

	// Calculate precision/recall
	const { precision, recall, f1 } = calculateToolSelectionMetrics(
		trajectory,
		expectation.requiredTools,
	);

	// Calculate efficiency
	const efficiency = calculateEfficiency(
		trajectory,
		expectation.requiredTools.length,
	);

	// Find unexpected tools
	const expectedToolsSet = new Set(expectation.requiredTools);
	const unexpectedTools = [...calledToolsSet].filter(
		(t) => !expectedToolsSet.has(t),
	);

	// Overall pass/fail
	const passed =
		requiredToolsPresent &&
		orderedToolsCorrect &&
		noForbiddenTools &&
		toolCountValid;

	return {
		passed,
		metrics: {
			requiredToolsPresent,
			orderedToolsCorrect,
			noForbiddenTools,
			toolCountValid,
			precision,
			recall,
			f1,
			efficiency,
		},
		details: {
			toolsCalled: calledTools,
			missingTools,
			unexpectedTools,
			forbiddenToolsCalled,
			toolCallCount: trajectory.length,
		},
	};
}

// =============================================================================
// SCORING FUNCTIONS
// =============================================================================

/**
 * Convert evaluation result to a single score (0-100)
 */
export function trajectoryToScore(result: TrajectoryEvaluationResult): number {
	const weights = {
		requiredToolsPresent: 30,
		orderedToolsCorrect: 15,
		noForbiddenTools: 20,
		toolCountValid: 10,
		f1: 25, // F1 contributes up to 25 points
	};

	let score = 0;

	if (result.metrics.requiredToolsPresent) score += weights.requiredToolsPresent;
	if (result.metrics.orderedToolsCorrect) score += weights.orderedToolsCorrect;
	if (result.metrics.noForbiddenTools) score += weights.noForbiddenTools;
	if (result.metrics.toolCountValid) score += weights.toolCountValid;
	score += result.metrics.f1 * weights.f1;

	return Math.round(score);
}

/**
 * Create a human-readable summary of the evaluation
 */
export function trajectoryToSummary(result: TrajectoryEvaluationResult): string {
	const lines: string[] = [];

	lines.push(`Trajectory Evaluation: ${result.passed ? "PASSED" : "FAILED"}`);
	lines.push(`Score: ${trajectoryToScore(result)}/100`);
	lines.push("");
	lines.push("Metrics:");
	lines.push(`  Required tools present: ${result.metrics.requiredToolsPresent}`);
	lines.push(`  Ordered tools correct: ${result.metrics.orderedToolsCorrect}`);
	lines.push(`  No forbidden tools: ${result.metrics.noForbiddenTools}`);
	lines.push(`  Tool count valid: ${result.metrics.toolCountValid}`);
	lines.push(`  Precision: ${(result.metrics.precision * 100).toFixed(1)}%`);
	lines.push(`  Recall: ${(result.metrics.recall * 100).toFixed(1)}%`);
	lines.push(`  F1: ${(result.metrics.f1 * 100).toFixed(1)}%`);
	lines.push(`  Efficiency: ${(result.metrics.efficiency * 100).toFixed(1)}%`);

	if (result.details.missingTools.length > 0) {
		lines.push("");
		lines.push(`Missing tools: ${result.details.missingTools.join(", ")}`);
	}

	if (result.details.forbiddenToolsCalled.length > 0) {
		lines.push("");
		lines.push(
			`Forbidden tools called: ${result.details.forbiddenToolsCalled.join(", ")}`,
		);
	}

	return lines.join("\n");
}
