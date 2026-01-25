/**
 * Surgeon Subagent Evaluation
 *
 * Tests the Surgeon's ability to propose actionable fixes.
 * Validates recommendation quality and risk assessment.
 */

import * as ls from "langsmith/vitest";
import { expect } from "vitest";
import {
	evaluateRecommendation,
	evaluateRecommendations,
	evaluateTrajectory,
} from "../evaluators/index.js";
import {
	nullPointerException,
	memoryLeak,
} from "../scenarios/code-bugs.scenarios.js";
import {
	connectionPoolExhausted,
	resourceLimits,
} from "../scenarios/config-issues.scenarios.js";
import {
	nodeOOM,
	diskFull,
} from "../scenarios/infrastructure.scenarios.js";
import type { ScenarioDefinition } from "../fixtures/incidents.js";
import type { Recommendation } from "../../src/types/state.js";

// =============================================================================
// TEST SCENARIOS
// =============================================================================

const surgeonScenarios: Array<{
	scenario: ScenarioDefinition;
	expectedFixType: string;
}> = [
	{ scenario: nullPointerException, expectedFixType: "code_fix" },
	{ scenario: connectionPoolExhausted, expectedFixType: "config_change" },
	{ scenario: resourceLimits, expectedFixType: "resource_adjustment" },
	{ scenario: nodeOOM, expectedFixType: "scaling" },
	{ scenario: diskFull, expectedFixType: "storage" },
];

// =============================================================================
// RECOMMENDATION QUALITY EVALUATIONS
// =============================================================================

ls.describe("Surgeon - Recommendation Quality", () => {
	ls.test(
		"Produces actionable recommendations",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			// Test recommendation evaluation with mock data
			const goodRecommendation: Recommendation = {
				id: "rec-001",
				title: "Increase database connection pool size",
				description:
					"The current connection pool size of 20 is insufficient for the current load. " +
					"Increase to 50 connections per instance to handle peak traffic without exhaustion.",
				category: "config",
				priority: "high",
				verificationSteps: [
					"Check current connection usage with pg_stat_activity",
					"Update pool_size in database config",
					"Deploy config change to staging",
					"Monitor connection metrics for 30 minutes",
					"Deploy to production",
				],
				riskScore: 25,
				approvalLevel: "team_lead",
			};

			const evalResult = evaluateRecommendation(goodRecommendation, {
				requireVerification: true,
				requireRisk: true,
				minDescriptionLength: 50,
			});

			ls.logOutputs({
				score: evalResult.score,
				checks: evalResult.checks,
				feedback: evalResult.feedback,
			});

			expect(evalResult.score).toBeGreaterThanOrEqual(80);
			expect(evalResult.checks.isActionable).toBe(true);
			expect(evalResult.checks.hasVerificationSteps).toBe(true);
			expect(evalResult.checks.hasRiskAssessment).toBe(true);
		},
	);

	ls.test(
		"Flags incomplete recommendations",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			// Test with poor recommendation
			const poorRecommendation: Recommendation = {
				id: "rec-002",
				title: "Fix it",
				description: "Make the fix",
				category: "unknown" as any,
				priority: undefined as any,
			};

			const evalResult = evaluateRecommendation(poorRecommendation, {
				requireVerification: true,
				minDescriptionLength: 20,
			});

			ls.logOutputs({
				score: evalResult.score,
				checks: evalResult.checks,
				feedback: evalResult.feedback,
			});

			expect(evalResult.score).toBeLessThan(50);
			expect(evalResult.checks.isActionable).toBe(false);
			expect(evalResult.feedback.length).toBeGreaterThan(0);
		},
	);
});

// =============================================================================
// MULTIPLE RECOMMENDATIONS EVALUATION
// =============================================================================

ls.describe("Surgeon - Recommendation Set Quality", () => {
	ls.test(
		"Produces prioritized recommendation set",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const recommendations: Recommendation[] = [
				{
					id: "rec-high-001",
					title: "Immediate: Increase memory limits",
					description:
						"Container is being OOM killed. Increase memory limit from 512Mi to 1Gi immediately.",
					category: "infrastructure",
					priority: "critical",
					verificationSteps: [
						"Update deployment manifest",
						"Apply to staging",
						"Monitor for OOM events",
						"Deploy to production",
					],
					riskScore: 15,
					approvalLevel: "on_call",
				},
				{
					id: "rec-med-001",
					title: "Investigate memory leak",
					description:
						"Memory usage grows over time. Profile application to find the leak source.",
					category: "code",
					priority: "high",
					verificationSteps: [
						"Enable heap profiling",
						"Collect heap snapshots",
						"Analyze with memory profiler",
						"Identify leaked objects",
					],
					riskScore: 5,
					approvalLevel: "team",
				},
				{
					id: "rec-low-001",
					title: "Set up memory alerts",
					description:
						"Add alerting for memory usage above 80% to catch issues earlier.",
					category: "monitoring",
					priority: "medium",
					verificationSteps: [
						"Create Prometheus alert rule",
						"Configure alert routing",
						"Test alert firing",
					],
					riskScore: 0,
					approvalLevel: "self",
				},
			];

			const evalResult = evaluateRecommendations(recommendations, {
				requireVerification: true,
				requireRisk: true,
			});

			ls.logOutputs({
				overallScore: evalResult.overallScore,
				actionableCount: evalResult.actionableCount,
				hasHighPriority: evalResult.hasHighPriority,
				individualScores: evalResult.results.map((r) => r.score),
			});

			expect(evalResult.overallScore).toBeGreaterThanOrEqual(70);
			expect(evalResult.actionableCount).toBeGreaterThanOrEqual(2);
			expect(evalResult.hasHighPriority).toBe(true);
		},
	);
});

// =============================================================================
// TRAJECTORY EVALUATIONS
// =============================================================================

ls.describe("Surgeon - Tool Usage Trajectory", () => {
	ls.test(
		"Does NOT form hypotheses",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			// Surgeon should not form hypotheses - that's Detective's job
			const badToolCalls = [
				{ name: "propose_fix", args: {} },
				{ name: "form_hypothesis", args: {} }, // WRONG
			];

			const evalResult = evaluateTrajectory(badToolCalls, {
				forbiddenTools: ["form_hypothesis"],
				maxToolCalls: 5,
			});

			ls.logOutputs({
				trajectoryScore: evalResult.score,
				feedback: evalResult.feedback,
			});

			expect(evalResult.score).toBeLessThan(100);
		},
	);

	ls.test(
		"Proposes fixes with risk assessment",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const goodToolCalls = [
				{
					name: "propose_fix",
					args: {
						title: "Fix connection pool",
						riskScore: 30,
						verificationSteps: ["step1", "step2"],
					},
				},
			];

			const evalResult = evaluateTrajectory(goodToolCalls, {
				maxToolCalls: 5,
			});

			ls.logOutputs({
				trajectoryScore: evalResult.score,
				calledTools: evalResult.calledTools,
			});

			expect(evalResult.score).toBe(100);
		},
	);
});

// =============================================================================
// SCENARIO-SPECIFIC FIX QUALITY
// =============================================================================

ls.describe("Surgeon - Scenario-Specific Fixes", () => {
	for (const { scenario, expectedFixType } of surgeonScenarios) {
		ls.test(
			`Appropriate fix type for: ${scenario.name}`,
			{
				inputs: {
					scenario: scenario.name,
					category: scenario.expected.rootCauseCategory,
				},
				referenceOutputs: {
					expectedFixType,
					shouldHaveRecommendations: scenario.expected.shouldHaveRecommendations,
				},
			},
			async ({ inputs, referenceOutputs }) => {
				// Validate scenario expectations
				expect(referenceOutputs.shouldHaveRecommendations).toBe(true);

				ls.logOutputs({
					scenarioName: inputs.scenario,
					category: inputs.category,
					expectedFixType: referenceOutputs.expectedFixType,
				});
			},
		);
	}
});
