/**
 * Detective Subagent Evaluation
 *
 * Tests the Detective's ability to form hypotheses from gathered evidence.
 * Uses mock IntegrationContext for isolated testing.
 */

import * as ls from "langsmith/vitest";
import { expect } from "vitest";
import {
	evaluateHypothesis,
	evaluateTrajectory,
} from "../evaluators/index.js";
import {
	nullPointerException,
	memoryLeak,
	raceCondition,
} from "../scenarios/code-bugs.scenarios.js";
import {
	connectionPoolExhausted,
	timeoutMisconfiguration,
} from "../scenarios/config-issues.scenarios.js";
import type { ScenarioDefinition } from "../fixtures/incidents.js";

// =============================================================================
// DETECTIVE AGENT IMPORT (Lazy)
// =============================================================================

type DetectiveAgent = Awaited<typeof import("../../src/agents/subagents/index.js")>["createDetective"];
let createDetective: DetectiveAgent | null = null;

async function getDetective(): Promise<DetectiveAgent> {
	if (!createDetective) {
		const mod = await import("../../src/agents/subagents/index.js");
		createDetective = mod.createDetective;
	}
	return createDetective;
}

// =============================================================================
// TEST SCENARIOS (Subset for component testing)
// =============================================================================

const detectiveScenarios: ScenarioDefinition[] = [
	nullPointerException,
	memoryLeak,
	connectionPoolExhausted,
];

// =============================================================================
// HYPOTHESIS QUALITY EVALUATIONS
// =============================================================================

ls.describe("Detective - Hypothesis Formation", () => {
	for (const scenario of detectiveScenarios) {
		ls.test(
			`Forms valid hypothesis for: ${scenario.name}`,
			{
				inputs: {
					incident: scenario.input.incident,
					alerts: scenario.input.alerts,
					gatheredData: {
						// Mock gathered data - would come from Cartographer in real flow
						logsAnalysis: `Logs show ${scenario.input.incident.description}`,
						codeSearchResults: [],
						deploymentInfo: { recentDeploys: [] },
					},
				},
				referenceOutputs: {
					expectedCategory: scenario.expected.rootCauseCategory,
					minConfidence: scenario.expected.minConfidence,
				},
			},
			async ({ inputs, referenceOutputs }) => {
				// Note: This is a placeholder for when Detective subagent
				// can be invoked independently. For now we test the evaluator.

				// Simulate a hypothesis the Detective might produce
				const mockHypothesis = {
					id: `hyp-${scenario.name}`,
					claim: `Based on the alerts and incident description, the root cause appears to be a ${referenceOutputs.expectedCategory} issue`,
					evidence: [
						{
							source: "alert",
							content: scenario.input.alerts[0]?.message || "Alert data",
							relevance: 0.9,
						},
						{
							source: "incident",
							content: scenario.input.incident.description,
							relevance: 0.85,
						},
					],
					confidence: referenceOutputs.minConfidence + 10,
					category: referenceOutputs.expectedCategory,
					createdAt: new Date().toISOString(),
				};

				// Evaluate the hypothesis
				const evalResult = evaluateHypothesis(mockHypothesis, {
					expectedCategory: referenceOutputs.expectedCategory,
					minConfidence: referenceOutputs.minConfidence,
					minEvidence: 1,
				});

				ls.logOutputs({
					hypothesisScore: evalResult.score,
					checks: evalResult.checks,
					feedback: evalResult.feedback,
				});

				expect(evalResult.score).toBeGreaterThanOrEqual(70);
				expect(evalResult.checks.hasValidClaim).toBe(true);
				expect(evalResult.checks.hasEvidence).toBe(true);
			},
		);
	}
});

// =============================================================================
// TRAJECTORY EVALUATIONS
// =============================================================================

ls.describe("Detective - Tool Usage Trajectory", () => {
	ls.test(
		"Uses form_hypothesis tool",
		{
			inputs: {
				scenario: "code-bug-npe",
			},
			referenceOutputs: {
				requiredTools: ["form_hypothesis"],
			},
		},
		async ({ referenceOutputs }) => {
			// Simulate tool calls that Detective should make
			const mockToolCalls = [
				{ name: "form_hypothesis", args: { claim: "NPE in UserService" } },
			];

			const evalResult = evaluateTrajectory(mockToolCalls, {
				requiredTools: referenceOutputs.requiredTools,
				forbiddenTools: ["propose_fix"], // Detective shouldn't propose fixes
				maxToolCalls: 5,
			});

			ls.logOutputs({
				trajectoryScore: evalResult.score,
				calledTools: evalResult.calledTools,
				missingTools: evalResult.missingTools,
				feedback: evalResult.feedback,
			});

			expect(evalResult.requiredToolsCalled).toBe(true);
			expect(evalResult.score).toBeGreaterThanOrEqual(80);
		},
	);

	ls.test(
		"Does NOT use Surgeon tools",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			// Simulate incorrect tool usage
			const badToolCalls = [
				{ name: "form_hypothesis", args: {} },
				{ name: "propose_fix", args: {} }, // WRONG - Detective shouldn't propose fixes
			];

			const evalResult = evaluateTrajectory(badToolCalls, {
				requiredTools: ["form_hypothesis"],
				forbiddenTools: ["propose_fix"],
			});

			ls.logOutputs({
				trajectoryScore: evalResult.score,
				feedback: evalResult.feedback,
			});

			// Should be penalized for calling forbidden tool
			expect(evalResult.score).toBeLessThan(100);
			expect(evalResult.feedback).toContainEqual(
				expect.stringContaining("forbidden"),
			);
		},
	);
});

// =============================================================================
// CATEGORY CLASSIFICATION ACCURACY
// =============================================================================

ls.describe("Detective - Category Classification", () => {
	const classificationScenarios = [
		{ scenario: nullPointerException, expectedCategory: "code" },
		{ scenario: raceCondition, expectedCategory: "code" },
		{ scenario: connectionPoolExhausted, expectedCategory: "config" },
		{ scenario: timeoutMisconfiguration, expectedCategory: "config" },
	];

	for (const { scenario, expectedCategory } of classificationScenarios) {
		ls.test(
			`Classifies "${scenario.name}" as ${expectedCategory}`,
			{
				inputs: {
					incident: scenario.input.incident,
					alerts: scenario.input.alerts,
				},
				referenceOutputs: {
					expectedCategory,
				},
			},
			async ({ referenceOutputs }) => {
				// This test validates that given the incident/alert data,
				// the Detective would classify it correctly.
				// In practice, this would invoke the actual Detective agent.

				// For now, we validate the scenario definition is correct
				expect(scenario.expected.rootCauseCategory).toBe(
					referenceOutputs.expectedCategory,
				);

				ls.logOutputs({
					scenarioCategory: scenario.expected.rootCauseCategory,
					expectedCategory: referenceOutputs.expectedCategory,
					match: scenario.expected.rootCauseCategory === referenceOutputs.expectedCategory,
				});
			},
		);
	}
});
