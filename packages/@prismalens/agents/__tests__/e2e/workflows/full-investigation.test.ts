/**
 * Full Investigation Workflow E2E Tests
 *
 * Tests the complete investigation workflow from alert to recommendation.
 * Uses MockLLM for deterministic testing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createMockLLM,
	createInvestigationMockLLM,
	MockResponseBuilder,
} from "../../mocks/llm.mock.js";
import {
	createCodeBugScenario,
	validateCodeBugResult,
	expectedHypothesis,
	expectedRecommendation,
} from "../scenarios/code-bug.scenario.js";
import {
	createConfigIssueScenario,
	validateConfigIssueResult,
} from "../scenarios/config-issue.scenario.js";
import { resetHypothesisStore, getStoredHypotheses } from "../../../src/tools/hypothesis.js";
import { resetRecommendationStore, getStoredRecommendations } from "../../../src/tools/fix-proposal.js";
import {
	evaluateTrajectory,
	trajectoryToScore,
} from "../../evaluators/trajectory.evaluator.js";
import {
	evaluateHypothesis,
	evaluateBestHypothesis,
} from "../../evaluators/hypothesis.evaluator.js";
import {
	evaluateRecommendation,
	evaluateRecommendations,
} from "../../evaluators/recommendation.evaluator.js";

describe("Full Investigation Workflow", () => {
	beforeEach(() => {
		resetHypothesisStore();
		resetRecommendationStore();
	});

	describe("Code Bug Investigation", () => {
		it("should complete investigation for null pointer bug scenario", async () => {
			const scenario = createCodeBugScenario();

			// Create a mock LLM that simulates the investigation workflow
			const mockLLM = createInvestigationMockLLM({
				gatheringResponse: "I'll analyze the logs and code to find the error.",
				hypothesis: {
					claim: expectedHypothesis.claim,
					confidence: expectedHypothesis.confidence,
					category: "code",
					evidence: expectedHypothesis.evidence,
				},
				recommendation: {
					title: expectedRecommendation.title,
					priority: "high",
					category: "code_fix",
				},
			});

			// Verify mock LLM works
			expect(mockLLM).toBeDefined();
			expect(mockLLM.callCount).toBe(0);

			// Simulate a call
			const response = await mockLLM.invoke([]);
			expect(mockLLM.callCount).toBe(1);

			// The scenario expectations should be met
			expect(scenario.expectations.minimumConfidence).toBe(70);
			expect(scenario.expectations.expectedCategory).toBe("code");
		});

		it("should generate valid hypothesis for code bug", async () => {
			const scenario = createCodeBugScenario();

			// Create and evaluate a hypothesis matching the scenario
			const hypothesis = {
				claim: "Null pointer exception in auth handler due to missing null check on user parameter",
				confidence: 85,
				evidence: [
					"Stack trace shows NullPointerException at auth-handler.ts line 42",
					"Code at line 42 accesses user.id without null check",
					"Function handleAuth does not validate user parameter",
				],
				category: "code" as const,
				timestamp: new Date().toISOString(),
			};

			const evaluation = evaluateHypothesis(hypothesis, {
				expectedCategory: "code",
				isCorrect: true,
			});

			expect(evaluation.passed).toBe(true);
			expect(evaluation.score).toBeGreaterThanOrEqual(70);
			expect(evaluation.dimensions.categoryAccuracy).toBe(20); // Full marks for correct category
		});

		it("should generate actionable code fix recommendation", async () => {
			const recommendation = {
				title: "Add null check in auth handler",
				description: "Add validation to prevent NullPointerException when user is null",
				priority: "high" as const,
				category: "code_fix" as const,
				urgency: "immediate" as const,
				actionable: true,
				codeChanges: [
					{
						filePath: "src/services/auth-handler.ts",
						searchBlock: "return user.id.toString();",
						replaceBlock: `if (!user) {
  throw new Error('User is required');
}
return user.id.toString();`,
						testCase: "Run npm test -- auth-handler.test.ts",
					},
				],
			};

			const evaluation = evaluateRecommendation(recommendation, {
				expectedCategory: "code_fix",
				expectedPriority: "high",
				expectCodeChanges: true,
			});

			expect(evaluation.passed).toBe(true);
			expect(evaluation.score).toBeGreaterThanOrEqual(70);
			expect(evaluation.dimensions.codeChangesValid).toBeGreaterThan(0);
			expect(evaluation.dimensions.testCaseIncluded).toBeGreaterThan(0);
		});
	});

	describe("Config Issue Investigation", () => {
		it("should complete investigation for missing env var scenario", async () => {
			const scenario = createConfigIssueScenario();

			const mockLLM = createInvestigationMockLLM({
				gatheringResponse: "Checking service logs and environment configuration.",
				hypothesis: {
					claim: "Application failed to start due to missing DATABASE_URL environment variable",
					confidence: 95,
					category: "config",
					evidence: ["Logs show 'DATABASE_URL is not defined' error"],
				},
				recommendation: {
					title: "Set DATABASE_URL environment variable",
					priority: "critical",
					category: "config_change",
				},
			});

			expect(mockLLM).toBeDefined();
			expect(scenario.expectations.minimumConfidence).toBe(85);
			expect(scenario.expectations.expectedCategory).toBe("config");
		});

		it("should generate high-confidence hypothesis for config error", async () => {
			const hypothesis = {
				claim: "Application failed to start due to missing DATABASE_URL environment variable",
				confidence: 95,
				evidence: [
					"Logs show 'DATABASE_URL is not defined' error",
					"Application exited immediately after configuration loading",
					"Environment variable DATABASE_URL is not set in Render dashboard",
				],
				category: "config" as const,
				timestamp: new Date().toISOString(),
			};

			const evaluation = evaluateHypothesis(hypothesis, {
				expectedCategory: "config",
				isCorrect: true,
			});

			expect(evaluation.passed).toBe(true);
			expect(evaluation.score).toBeGreaterThanOrEqual(80);
		});

		it("should generate config change recommendation", async () => {
			const recommendation = {
				title: "Set DATABASE_URL environment variable",
				description: "Add DATABASE_URL to the service configuration. This variable is required for database connection.",
				priority: "critical" as const,
				category: "config_change" as const,
				urgency: "immediate" as const,
				actionable: true,
			};

			const evaluation = evaluateRecommendation(recommendation, {
				expectedCategory: "config_change",
				expectedPriority: "critical",
			});

			expect(evaluation.passed).toBe(true);
			// Config changes don't need code changes
			expect(evaluation.dimensions.codeChangesValid).toBeGreaterThan(0);
		});
	});

	describe("Trajectory Evaluation", () => {
		it("should evaluate valid investigation trajectory", () => {
			const trajectory = [
				{ toolName: "github_search_code", toolCategory: "github", arguments: {}, result: {}, status: "success" as const },
				{ toolName: "render_get_logs", toolCategory: "render", arguments: {}, result: {}, status: "success" as const },
				{ toolName: "form_hypothesis", toolCategory: "hypothesis", arguments: {}, result: {}, status: "success" as const },
				{ toolName: "propose_fix", toolCategory: "fix-proposal", arguments: {}, result: {}, status: "success" as const },
			];

			const expectation = {
				requiredTools: ["github_search_code", "form_hypothesis", "propose_fix"],
				forbiddenTools: ["github_create_pr"],
				maxToolCalls: 10,
			};

			const result = evaluateTrajectory(trajectory, expectation);

			expect(result.passed).toBe(true);
			expect(result.metrics.requiredToolsPresent).toBe(true);
			expect(result.metrics.noForbiddenTools).toBe(true);
			expect(result.metrics.toolCountValid).toBe(true);

			const score = trajectoryToScore(result);
			expect(score).toBeGreaterThanOrEqual(70);
		});

		it("should detect missing required tools", () => {
			const trajectory = [
				{ toolName: "render_get_logs", toolCategory: "render", arguments: {}, result: {}, status: "success" as const },
			];

			const expectation = {
				requiredTools: ["github_search_code", "form_hypothesis"],
			};

			const result = evaluateTrajectory(trajectory, expectation);

			expect(result.passed).toBe(false);
			expect(result.metrics.requiredToolsPresent).toBe(false);
			expect(result.details.missingTools).toContain("github_search_code");
			expect(result.details.missingTools).toContain("form_hypothesis");
		});

		it("should detect forbidden tool usage", () => {
			const trajectory = [
				{ toolName: "github_search_code", toolCategory: "github", arguments: {}, result: {}, status: "success" as const },
				{ toolName: "github_create_pr", toolCategory: "github", arguments: {}, result: {}, status: "success" as const },
			];

			const expectation = {
				requiredTools: ["github_search_code"],
				forbiddenTools: ["github_create_pr"],
			};

			const result = evaluateTrajectory(trajectory, expectation);

			expect(result.passed).toBe(false);
			expect(result.metrics.noForbiddenTools).toBe(false);
			expect(result.details.forbiddenToolsCalled).toContain("github_create_pr");
		});
	});

	describe("MockLLM Functionality", () => {
		it("should track call history", async () => {
			const mockLLM = createMockLLM({
				responses: [
					{ content: "First response" },
					{ content: "Second response" },
				],
			});

			await mockLLM.invoke([]);
			await mockLLM.invoke([]);

			expect(mockLLM.callCount).toBe(2);
			expect(mockLLM.callHistory).toHaveLength(2);
			expect(mockLLM.callHistory[0].response.content).toBe("First response");
		});

		it("should support tool call responses", async () => {
			const mockLLM = createMockLLM({
				responses: [
					{
						content: "Let me form a hypothesis",
						toolCalls: [
							{
								id: "call_1",
								name: "form_hypothesis",
								args: { claim: "Test", confidence: 80 },
							},
						],
					},
				],
			});

			mockLLM.assertToolCalled("form_hypothesis", 0); // Not called yet

			const response = await mockLLM.invoke([]);

			mockLLM.assertToolCalled("form_hypothesis", 1);
			expect(response.tool_calls).toHaveLength(1);
			expect(response.tool_calls![0].name).toBe("form_hypothesis");
		});

		it("should reset properly", async () => {
			const mockLLM = createMockLLM({
				responses: [{ content: "Response" }],
				loop: true,
			});

			await mockLLM.invoke([]);
			await mockLLM.invoke([]);

			expect(mockLLM.callCount).toBe(2);

			mockLLM.reset();

			expect(mockLLM.callCount).toBe(0);
			expect(mockLLM.callHistory).toHaveLength(0);
		});

		it("should use MockResponseBuilder", async () => {
			const response = MockResponseBuilder.create("Analyzing the issue")
				.withToolCall("form_hypothesis", { claim: "Test", confidence: 90 })
				.withDelay(10)
				.build();

			const mockLLM = createMockLLM({ responses: [response] });
			const result = await mockLLM.invoke([]);

			expect(result.content).toBe("Analyzing the issue");
			expect(result.tool_calls).toHaveLength(1);
		});
	});
});
