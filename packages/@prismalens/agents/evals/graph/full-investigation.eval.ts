/**
 * Full Investigation Graph Evaluation
 *
 * Tests the complete investigation workflow from alert to recommendation.
 * Uses real LLM calls and evaluates end-to-end quality.
 */

import * as ls from "langsmith/vitest";
import { expect } from "vitest";
import {
	evaluateHypotheses,
	evaluateRecommendations,
	evaluateTrajectory,
	extractToolCalls,
	EXPECTED_INVESTIGATION_TRAJECTORY,
} from "../evaluators/index.js";
import { getTestLLMConfigWithOverrides } from "../fixtures/llm-config.js";
import {
	getSmokeTestScenarios,
	scenariosByDifficulty,
	allScenarios,
	cloneScenariosByDifficulty,
} from "../scenarios/index.js";

// Get the LLM config once for all tests (wrapped format for state compatibility)
const llmConfig = getTestLLMConfigWithOverrides();

// Configurable timeout for LLM operations (default 5 min, override with TEST_TIMEOUT_MS)
const testTimeout = parseInt(process.env.TEST_TIMEOUT_MS || "300000", 10);

// =============================================================================
// GRAPH IMPORT (Lazy)
// =============================================================================

type Graph = Awaited<typeof import("../../src/graph/graph.js")>["investigationGraph"];
let graph: Graph | null = null;

async function getGraph(): Promise<Graph> {
	if (!graph) {
		const mod = await import("../../src/graph/graph.js");
		graph = mod.investigationGraph;
	}
	return graph;
}

// =============================================================================
// HELPER: Build Graph Input
// =============================================================================

/**
 * Build graph invocation payload from scenario input.
 * Ensures all input fields are passed to the graph including:
 * - preGatheredContext (for gatherer agents)
 * - clonePaths (for repo tools)
 * - integrations (for API-based tools)
 */
function buildGraphInput(inputs: {
	investigationId: string;
	incidentId: string;
	priority: string;
	incident: unknown;
	alerts: unknown[];
	preGatheredContext?: unknown;
	clonePaths?: Record<string, string>;
	integrations?: unknown[];
}) {
	return {
		investigationId: inputs.investigationId,
		incidentId: inputs.incidentId,
		priority: inputs.priority,
		incident: inputs.incident,
		alerts: inputs.alerts,
		preGatheredContext: inputs.preGatheredContext,
		clonePaths: inputs.clonePaths,
		integrations: inputs.integrations || [],
		llmConfig,
	};
}

// =============================================================================
// SMOKE TEST (Quick validation)
// =============================================================================

ls.describe("[E2E] Graph › Smoke Test", () => {
	const smokeScenarios = getSmokeTestScenarios();

	for (const scenario of smokeScenarios) {
		ls.test(
			`Smoke: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: scenario.expected,
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Smoke] Running: ${scenario.name}`);
				const startTime = Date.now();

				const result = await g.invoke(buildGraphInput(inputs));

				const duration = Date.now() - startTime;
				console.log(`[Smoke] Completed in ${duration}ms`);

				ls.logOutputs({
					status: result.status,
					confidence: result.confidence,
					rootCauseCategory: result.rootCauseCategory,
					hypothesesCount: result.hypotheses?.length || 0,
					recommendationsCount: result.recommendations?.length || 0,
					durationMs: duration,
				});

				// Basic assertions
				expect(result.status).toBe(referenceOutputs.status);
				// confidence can be null if no hypotheses were formed - use ?? 0 to handle null
				expect(result.confidence ?? 0).toBeGreaterThanOrEqual(0);

				// Should produce some output
				expect(result.hypotheses?.length ?? 0).toBeGreaterThan(0);

				console.log(`[Smoke] PASS: ${scenario.name}`);
			},
			testTimeout,
		);
	}
});

// =============================================================================
// EASY SCENARIOS (High confidence required)
// =============================================================================

ls.describe("[E2E] Graph › Easy Scenarios", () => {
	const easyScenarios = scenariosByDifficulty.easy;

	for (const scenario of easyScenarios) {
		ls.test(
			`Easy: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: scenario.expected,
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Easy] Running: ${scenario.name}`);
				const result = await g.invoke(buildGraphInput(inputs));

				// Evaluate hypotheses
				const hypothesisEval = evaluateHypotheses(result.hypotheses || [], {
					expectedCategory: referenceOutputs.rootCauseCategory,
					minConfidence: referenceOutputs.minConfidence,
				});

				// Evaluate recommendations
				const recEval = evaluateRecommendations(result.recommendations || []);

				ls.logOutputs({
					status: result.status,
					confidence: result.confidence,
					rootCauseCategory: result.rootCauseCategory,
					hypothesisScore: hypothesisEval.overallScore,
					recommendationScore: recEval.overallScore,
					actionableRecommendations: recEval.actionableCount,
				});

				// Stricter assertions for easy scenarios
				expect(result.status).toBe(referenceOutputs.status);
				expect(result.confidence ?? 0).toBeGreaterThanOrEqual(
					referenceOutputs.minConfidence,
				);
				expect(result.rootCauseCategory).toBe(referenceOutputs.rootCauseCategory);
				expect(hypothesisEval.overallScore).toBeGreaterThanOrEqual(60);

				if (referenceOutputs.shouldHaveRecommendations) {
					expect(recEval.actionableCount).toBeGreaterThan(0);
				}
			},
			testTimeout,
		);
	}
});

// =============================================================================
// MEDIUM SCENARIOS (Moderate confidence)
// =============================================================================

ls.describe("[E2E] Graph › Medium Scenarios", () => {
	const mediumScenarios = scenariosByDifficulty.medium;

	for (const scenario of mediumScenarios) {
		ls.test(
			`Medium: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: scenario.expected,
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Medium] Running: ${scenario.name}`);
				const result = await g.invoke(buildGraphInput(inputs));

				const hypothesisEval = evaluateHypotheses(result.hypotheses || [], {
					expectedCategory: referenceOutputs.rootCauseCategory,
				});

				const recEval = evaluateRecommendations(result.recommendations || []);

				ls.logOutputs({
					status: result.status,
					confidence: result.confidence,
					rootCauseCategory: result.rootCauseCategory,
					hypothesisScore: hypothesisEval.overallScore,
					recommendationScore: recEval.overallScore,
					bestHypothesis: hypothesisEval.bestHypothesis?.claim,
				});

				// Medium scenarios have more lenient assertions
				expect(result.status).toBe(referenceOutputs.status);
				expect(result.confidence ?? 0).toBeGreaterThanOrEqual(
					referenceOutputs.minConfidence * 0.8, // Allow 20% variance
				);
				expect(hypothesisEval.overallScore).toBeGreaterThanOrEqual(40);
			},
			testTimeout,
		);
	}
});

// =============================================================================
// HARD SCENARIOS (Lower confidence acceptable)
// =============================================================================

ls.describe("[E2E] Graph › Hard Scenarios", () => {
	const hardScenarios = scenariosByDifficulty.hard;

	for (const scenario of hardScenarios) {
		ls.test(
			`Hard: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: scenario.expected,
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Hard] Running: ${scenario.name}`);
				const result = await g.invoke(buildGraphInput(inputs));

				const hypothesisEval = evaluateHypotheses(result.hypotheses || []);
				const recEval = evaluateRecommendations(result.recommendations || []);

				ls.logOutputs({
					status: result.status,
					confidence: result.confidence,
					rootCauseCategory: result.rootCauseCategory,
					hypothesisScore: hypothesisEval.overallScore,
					recommendationScore: recEval.overallScore,
					summary: result.summary,
				});

				// Hard scenarios: just check it completes and produces output
				expect(result.status).toBe(referenceOutputs.status);
				expect(result.hypotheses?.length || 0).toBeGreaterThan(0);

				// Log category match for analysis
				const categoryMatch =
					result.rootCauseCategory === referenceOutputs.rootCauseCategory;
				console.log(
					`[Hard] Category: ${result.rootCauseCategory} (expected: ${referenceOutputs.rootCauseCategory}, match: ${categoryMatch})`,
				);
			},
			testTimeout,
		);
	}
});

// =============================================================================
// ROOT CAUSE KEYWORD MATCHING
// =============================================================================

ls.describe("[E2E] Graph › Root Cause Keywords", () => {
	// Only test scenarios with keyword expectations
	const keywordScenarios = allScenarios.filter(
		(s) => s.expected.rootCauseKeywords?.length,
	);

	for (const scenario of keywordScenarios.slice(0, 5)) {
		// Limit to 5 for CI time
		ls.test(
			`Keywords: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: {
					keywords: scenario.expected.rootCauseKeywords || [],
				},
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				const result = await g.invoke(buildGraphInput(inputs));

				// Check if keywords appear in root cause or summary
				const combinedText = [
					result.rootCause || "",
					result.summary || "",
					...(result.hypotheses?.map((h: any) => h.claim) || []),
				]
					.join(" ")
					.toLowerCase();

				const keywordMatches = referenceOutputs.keywords.filter((kw: string) =>
					combinedText.includes(kw.toLowerCase()),
				);

				const matchRatio = keywordMatches.length / referenceOutputs.keywords.length;

				ls.logOutputs({
					expectedKeywords: referenceOutputs.keywords,
					matchedKeywords: keywordMatches,
					matchRatio,
					rootCause: result.rootCause,
				});

				// At least 50% of keywords should appear
				expect(matchRatio).toBeGreaterThanOrEqual(0.5);
			},
			testTimeout,
		);
	}
});

// =============================================================================
// CLONE SCENARIOS (Repo Tools Required)
// =============================================================================

ls.describe("[E2E] Graph › Clone Scenarios", () => {
	const allCloneScenarios = [
		...cloneScenariosByDifficulty.easy,
		...cloneScenariosByDifficulty.medium,
		...cloneScenariosByDifficulty.hard,
	];

	for (const scenario of allCloneScenarios) {
		ls.test(
			`Clone: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: scenario.expected,
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Clone] Running: ${scenario.name}`);
				const startTime = Date.now();

				const result = await g.invoke(buildGraphInput(inputs));

				const duration = Date.now() - startTime;
				console.log(`[Clone] Completed in ${duration}ms`);

				// Extract tool calls for trajectory validation
				const toolCalls = extractToolCalls(result);

				// Evaluate trajectory - check repo tools were used
				const trajectoryEval = evaluateTrajectory(toolCalls, {
					requiredTools: referenceOutputs.expectedToolCalls || [],
					forbiddenTools: referenceOutputs.forbiddenToolCalls || [],
					maxToolCalls: 30,
				});

				// Evaluate hypotheses
				const hypothesisEval = evaluateHypotheses(result.hypotheses || [], {
					expectedCategory: referenceOutputs.rootCauseCategory,
					minConfidence: referenceOutputs.minConfidence,
				});

				// Evaluate recommendations
				const recEval = evaluateRecommendations(result.recommendations || []);

				ls.logOutputs({
					status: result.status,
					confidence: result.confidence,
					rootCauseCategory: result.rootCauseCategory,
					hypothesisScore: hypothesisEval.overallScore,
					recommendationScore: recEval.overallScore,
					trajectoryScore: trajectoryEval.score,
					requiredToolsCalled: trajectoryEval.requiredToolsCalled,
					missingTools: trajectoryEval.missingTools,
					calledTools: trajectoryEval.calledTools,
					durationMs: duration,
				});

				// Basic assertions
				expect(result.status).toBe(referenceOutputs.status);
				expect(result.confidence ?? 0).toBeGreaterThanOrEqual(
					referenceOutputs.minConfidence * 0.8, // Allow 20% variance
				);

				// Clone-specific: validate repo tools were called
				if (referenceOutputs.expectedToolCalls?.length) {
					expect(trajectoryEval.requiredToolsCalled).toBe(true);
				}

				// Validate no forbidden tools were called
				if (referenceOutputs.forbiddenToolCalls?.length) {
					const calledForbidden = referenceOutputs.forbiddenToolCalls.filter(
						(t: string) => trajectoryEval.calledTools.includes(t),
					);
					expect(calledForbidden).toHaveLength(0);
				}

				// Should produce recommendations for code scenarios
				if (referenceOutputs.shouldHaveRecommendations) {
					expect(recEval.actionableCount).toBeGreaterThan(0);
				}

				console.log(`[Clone] PASS: ${scenario.name}`);
			},
			testTimeout,
		);
	}
});

// =============================================================================
// TRAJECTORY VALIDATION (Non-Clone - Repo Tools Forbidden)
// =============================================================================

ls.describe("[E2E] Graph › Trajectory Validation", () => {
	// Test that non-clone scenarios don't use repo tools
	const nonCloneScenarios = allScenarios.filter(
		(s) => s.expected.forbiddenToolCalls?.length,
	);

	for (const scenario of nonCloneScenarios.slice(0, 3)) {
		// Limit to 3 for CI time
		ls.test(
			`NoRepoTools: ${scenario.name}`,
			{
				inputs: scenario.input,
				referenceOutputs: {
					forbiddenTools: scenario.expected.forbiddenToolCalls || [],
				},
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Trajectory] Running: ${scenario.name}`);
				const result = await g.invoke(buildGraphInput(inputs));

				// Extract tool calls
				const toolCalls = extractToolCalls(result);

				// Evaluate trajectory - check forbidden tools were NOT used
				const trajectoryEval = evaluateTrajectory(toolCalls, {
					forbiddenTools: referenceOutputs.forbiddenTools,
					maxToolCalls: 25,
				});

				// Find any forbidden tools that were called
				const calledForbidden = referenceOutputs.forbiddenTools.filter(
					(t: string) => trajectoryEval.calledTools.includes(t),
				);

				ls.logOutputs({
					status: result.status,
					calledTools: trajectoryEval.calledTools,
					forbiddenTools: referenceOutputs.forbiddenTools,
					calledForbidden,
					passed: calledForbidden.length === 0,
				});

				// Assert no forbidden tools were called
				expect(calledForbidden).toHaveLength(0);
			},
			testTimeout,
		);
	}
});

// =============================================================================
// PERFORMANCE BENCHMARKS
// =============================================================================

ls.describe("[E2E] Graph › Performance", () => {
	ls.test(
		"Completes within timeout",
		{
			inputs: getSmokeTestScenarios()[0]?.input,
			referenceOutputs: { maxDurationMs: 120000 }, // 2 minutes
		},
		async ({ inputs, referenceOutputs }) => {
			if (!inputs) {
				console.log("[Perf] No scenarios available, skipping");
				return;
			}

			const g = await getGraph();

			const startTime = Date.now();
			const result = await g.invoke(buildGraphInput(inputs));
			const duration = Date.now() - startTime;

			ls.logOutputs({
				durationMs: duration,
				maxDurationMs: referenceOutputs.maxDurationMs,
				withinLimit: duration <= referenceOutputs.maxDurationMs,
				status: result.status,
			});

			expect(duration).toBeLessThanOrEqual(referenceOutputs.maxDurationMs);
			expect(result.status).not.toBe("failed");
		},
		testTimeout,
	);
});
