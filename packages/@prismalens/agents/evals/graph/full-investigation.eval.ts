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
import {
	getSmokeTestScenarios,
	scenariosByDifficulty,
	allScenarios,
} from "../scenarios/index.js";
import type { ScenarioDefinition } from "../fixtures/incidents.js";

// =============================================================================
// GRAPH IMPORT (Lazy)
// =============================================================================

type Graph = Awaited<typeof import("../../src/graph/studio.js")>["graph"];
let graph: Graph | null = null;

async function getGraph(): Promise<Graph> {
	if (!graph) {
		const mod = await import("../../src/graph/studio.js");
		graph = mod.graph;
	}
	return graph;
}

// =============================================================================
// SMOKE TEST (Quick validation)
// =============================================================================

ls.describe("Investigation - Smoke Test", () => {
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

				const result = await g.invoke({
					investigationId: inputs.investigationId,
					incidentId: inputs.incidentId,
					priority: inputs.priority,
					incident: inputs.incident,
					alerts: inputs.alerts,
					integrations: [], // No integrations for smoke test
				});

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
				expect(result.confidence).toBeGreaterThanOrEqual(0);

				// Should produce some output
				expect(result.hypotheses?.length || 0).toBeGreaterThan(0);

				console.log(`[Smoke] PASS: ${scenario.name}`);
			},
		);
	}
});

// =============================================================================
// EASY SCENARIOS (High confidence required)
// =============================================================================

ls.describe("Investigation - Easy Scenarios", () => {
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
				const result = await g.invoke({
					investigationId: inputs.investigationId,
					incidentId: inputs.incidentId,
					priority: inputs.priority,
					incident: inputs.incident,
					alerts: inputs.alerts,
					integrations: [],
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
					actionableRecommendations: recEval.actionableCount,
				});

				// Stricter assertions for easy scenarios
				expect(result.status).toBe(referenceOutputs.status);
				expect(result.confidence).toBeGreaterThanOrEqual(
					referenceOutputs.minConfidence,
				);
				expect(result.rootCauseCategory).toBe(referenceOutputs.rootCauseCategory);
				expect(hypothesisEval.overallScore).toBeGreaterThanOrEqual(60);

				if (referenceOutputs.shouldHaveRecommendations) {
					expect(recEval.actionableCount).toBeGreaterThan(0);
				}
			},
		);
	}
});

// =============================================================================
// MEDIUM SCENARIOS (Moderate confidence)
// =============================================================================

ls.describe("Investigation - Medium Scenarios", () => {
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
				const result = await g.invoke({
					investigationId: inputs.investigationId,
					incidentId: inputs.incidentId,
					priority: inputs.priority,
					incident: inputs.incident,
					alerts: inputs.alerts,
					integrations: [],
				});

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
				expect(result.confidence).toBeGreaterThanOrEqual(
					referenceOutputs.minConfidence * 0.8, // Allow 20% variance
				);
				expect(hypothesisEval.overallScore).toBeGreaterThanOrEqual(40);
			},
		);
	}
});

// =============================================================================
// HARD SCENARIOS (Lower confidence acceptable)
// =============================================================================

ls.describe("Investigation - Hard Scenarios", () => {
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
				const result = await g.invoke({
					investigationId: inputs.investigationId,
					incidentId: inputs.incidentId,
					priority: inputs.priority,
					incident: inputs.incident,
					alerts: inputs.alerts,
					integrations: [],
				});

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
		);
	}
});

// =============================================================================
// ROOT CAUSE KEYWORD MATCHING
// =============================================================================

ls.describe("Investigation - Root Cause Keywords", () => {
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

				const result = await g.invoke({
					investigationId: inputs.investigationId,
					incidentId: inputs.incidentId,
					priority: inputs.priority,
					incident: inputs.incident,
					alerts: inputs.alerts,
					integrations: [],
				});

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
		);
	}
});

// =============================================================================
// PERFORMANCE BENCHMARKS
// =============================================================================

ls.describe("Investigation - Performance", () => {
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
			const result = await g.invoke({
				...inputs,
				integrations: [],
			});
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
	);
});
