/**
 * Fix Proposal Tool Evaluation
 *
 * Tests the propose_fix tool in isolation.
 * Validates recommendation quality, risk assessment, and verification steps.
 */

import * as ls from "langsmith/vitest";
import { expect } from "vitest";
import { evaluateRecommendation } from "../evaluators/index.js";
import type { Recommendation } from "../../src/types/state.js";

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

ls.describe("Fix Proposal Tool - Schema", () => {
	ls.test(
		"Accepts complete recommendation",
		{
			inputs: {
				title: "Increase database connection pool size",
				description:
					"The connection pool is exhausted under load. " +
					"Increase pool_size from 20 to 50 to handle peak traffic.",
				category: "config",
				priority: "high",
				verificationSteps: [
					"Apply change to staging",
					"Load test with 2x normal traffic",
					"Monitor connection metrics",
					"Deploy to production",
				],
				riskScore: 25,
				approvalLevel: "team_lead",
			},
			referenceOutputs: {
				shouldBeValid: true,
			},
		},
		async ({ inputs, referenceOutputs }) => {
			const recommendation: Recommendation = {
				id: "test-rec-001",
				title: inputs.title,
				description: inputs.description,
				category: inputs.category as Recommendation["category"],
				priority: inputs.priority as Recommendation["priority"],
				verificationSteps: inputs.verificationSteps,
				riskScore: inputs.riskScore,
				approvalLevel: inputs.approvalLevel as Recommendation["approvalLevel"],
			};

			const evalResult = evaluateRecommendation(recommendation, {
				requireVerification: true,
				requireRisk: true,
			});

			ls.logOutputs({
				score: evalResult.score,
				checks: evalResult.checks,
				isValid: evalResult.checks.isActionable,
			});

			expect(evalResult.checks.hasTitle).toBe(true);
			expect(evalResult.checks.hasDescription).toBe(true);
			expect(evalResult.checks.hasCategory).toBe(true);
			expect(evalResult.checks.hasPriority).toBe(true);
			expect(evalResult.checks.hasVerificationSteps).toBe(true);
			expect(evalResult.checks.hasRiskAssessment).toBe(true);
			expect(evalResult.checks.isActionable).toBe(true);
			expect(evalResult.score).toBeGreaterThanOrEqual(90);
		},
	);

	ls.test(
		"Rejects incomplete recommendation",
		{
			inputs: {
				title: "Fix",
				description: "Fix it",
			},
			referenceOutputs: {
				shouldBeValid: false,
			},
		},
		async ({ inputs }) => {
			const recommendation: Recommendation = {
				id: "test-rec-002",
				title: inputs.title,
				description: inputs.description,
				category: "unknown" as any,
				priority: undefined as any,
			};

			const evalResult = evaluateRecommendation(recommendation, {
				requireVerification: true,
				minDescriptionLength: 20,
			});

			ls.logOutputs({
				score: evalResult.score,
				checks: evalResult.checks,
				feedback: evalResult.feedback,
			});

			expect(evalResult.checks.isActionable).toBe(false);
			expect(evalResult.score).toBeLessThan(50);
			expect(evalResult.feedback.length).toBeGreaterThan(0);
		},
	);
});

// =============================================================================
// VERIFICATION STEPS
// =============================================================================

ls.describe("Fix Proposal Tool - Verification Steps", () => {
	ls.test(
		"Good verification steps",
		{
			inputs: {
				steps: [
					"Create backup of current configuration",
					"Apply change to staging environment",
					"Run integration tests",
					"Monitor for 30 minutes",
					"Deploy to production",
					"Verify metrics return to normal",
				],
			},
			referenceOutputs: {
				minSteps: 3,
			},
		},
		async ({ inputs, referenceOutputs }) => {
			const recommendation: Recommendation = {
				id: "test-verify-001",
				title: "Database configuration change",
				description: "Update database pool settings to improve performance",
				category: "config",
				priority: "high",
				verificationSteps: inputs.steps,
			};

			const evalResult = evaluateRecommendation(recommendation, {
				requireVerification: true,
			});

			ls.logOutputs({
				stepCount: inputs.steps.length,
				hasVerificationSteps: evalResult.checks.hasVerificationSteps,
				score: evalResult.score,
			});

			expect(evalResult.checks.hasVerificationSteps).toBe(true);
			expect(inputs.steps.length).toBeGreaterThanOrEqual(referenceOutputs.minSteps);
		},
	);

	ls.test(
		"Missing verification steps",
		{
			inputs: {
				steps: [],
			},
			referenceOutputs: {},
		},
		async ({ inputs }) => {
			const recommendation: Recommendation = {
				id: "test-verify-002",
				title: "Restart the service",
				description: "Restart the service to apply changes",
				category: "infrastructure",
				priority: "medium",
				verificationSteps: inputs.steps,
			};

			const evalResult = evaluateRecommendation(recommendation, {
				requireVerification: true,
			});

			ls.logOutputs({
				hasVerificationSteps: evalResult.checks.hasVerificationSteps,
				feedback: evalResult.feedback,
			});

			expect(evalResult.checks.hasVerificationSteps).toBe(false);
			expect(evalResult.feedback).toContainEqual(
				expect.stringContaining("Verification"),
			);
		},
	);
});

// =============================================================================
// RISK ASSESSMENT
// =============================================================================

ls.describe("Fix Proposal Tool - Risk Assessment", () => {
	const riskTestCases = [
		{
			name: "Low risk change",
			riskScore: 10,
			approvalLevel: "self",
			description: "Add logging statement",
			expectedRisk: "low",
		},
		{
			name: "Medium risk change",
			riskScore: 40,
			approvalLevel: "team_lead",
			description: "Update database configuration",
			expectedRisk: "medium",
		},
		{
			name: "High risk change",
			riskScore: 75,
			approvalLevel: "engineering_manager",
			description: "Change authentication system",
			expectedRisk: "high",
		},
		{
			name: "Critical risk change",
			riskScore: 95,
			approvalLevel: "cto",
			description: "Migrate production database",
			expectedRisk: "critical",
		},
	];

	for (const testCase of riskTestCases) {
		ls.test(
			testCase.name,
			{
				inputs: {
					riskScore: testCase.riskScore,
					approvalLevel: testCase.approvalLevel,
					description: testCase.description,
				},
				referenceOutputs: {
					expectedRisk: testCase.expectedRisk,
				},
			},
			async ({ inputs }) => {
				const recommendation: Recommendation = {
					id: `test-risk-${testCase.name}`,
					title: testCase.name,
					description: inputs.description,
					category: "config",
					priority: "high",
					riskScore: inputs.riskScore,
					approvalLevel: inputs.approvalLevel as Recommendation["approvalLevel"],
				};

				const evalResult = evaluateRecommendation(recommendation, {
					requireRisk: true,
				});

				ls.logOutputs({
					riskScore: inputs.riskScore,
					approvalLevel: inputs.approvalLevel,
					hasRiskAssessment: evalResult.checks.hasRiskAssessment,
					score: evalResult.score,
				});

				expect(evalResult.checks.hasRiskAssessment).toBe(true);
			},
		);
	}

	ls.test(
		"Missing risk assessment",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const recommendation: Recommendation = {
				id: "test-risk-missing",
				title: "Make a change",
				description: "This change might have unknown consequences",
				category: "code",
				priority: "high",
				// No riskScore or approvalLevel
			};

			const evalResult = evaluateRecommendation(recommendation, {
				requireRisk: true,
			});

			ls.logOutputs({
				hasRiskAssessment: evalResult.checks.hasRiskAssessment,
				feedback: evalResult.feedback,
			});

			expect(evalResult.checks.hasRiskAssessment).toBe(false);
			expect(evalResult.feedback).toContainEqual(
				expect.stringContaining("risk"),
			);
		},
	);
});

// =============================================================================
// PRIORITY LEVELS
// =============================================================================

ls.describe("Fix Proposal Tool - Priority", () => {
	const priorities: Recommendation["priority"][] = [
		"critical",
		"high",
		"medium",
		"low",
	];

	for (const priority of priorities) {
		ls.test(
			`Priority: ${priority}`,
			{
				inputs: { priority },
				referenceOutputs: {},
			},
			async ({ inputs }) => {
				const recommendation: Recommendation = {
					id: `test-priority-${inputs.priority}`,
					title: `${inputs.priority} priority fix`,
					description: "A recommendation with specific priority",
					category: "code",
					priority: inputs.priority,
				};

				const evalResult = evaluateRecommendation(recommendation);

				ls.logOutputs({
					priority: inputs.priority,
					hasPriority: evalResult.checks.hasPriority,
					score: evalResult.score,
				});

				expect(evalResult.checks.hasPriority).toBe(true);
			},
		);
	}
});

// =============================================================================
// ACTIONABILITY
// =============================================================================

ls.describe("Fix Proposal Tool - Actionability", () => {
	ls.test(
		"Actionable recommendation",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const recommendation: Recommendation = {
				id: "test-actionable",
				title: "Increase memory limit to 2Gi",
				description:
					"The container is being OOM killed with the current 1Gi limit. " +
					"Memory profiling shows the application needs at least 1.5Gi under load. " +
					"Recommend increasing to 2Gi with a 1.5Gi request.",
				category: "infrastructure",
				priority: "high",
				verificationSteps: [
					"Update deployment.yaml with new memory limits",
					"Apply to staging namespace",
					"Run load test for 15 minutes",
					"Verify no OOM kills in pod events",
					"Apply to production",
				],
				riskScore: 15,
			};

			const evalResult = evaluateRecommendation(recommendation);

			ls.logOutputs({
				isActionable: evalResult.checks.isActionable,
				score: evalResult.score,
				allChecks: evalResult.checks,
			});

			expect(evalResult.checks.isActionable).toBe(true);
			expect(evalResult.score).toBeGreaterThanOrEqual(80);
		},
	);

	ls.test(
		"Non-actionable: vague recommendation",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const recommendation: Recommendation = {
				id: "test-vague",
				title: "Improve performance",
				description: "Make it faster",
				category: "unknown" as any,
				priority: undefined as any,
			};

			const evalResult = evaluateRecommendation(recommendation, {
				minDescriptionLength: 20,
			});

			ls.logOutputs({
				isActionable: evalResult.checks.isActionable,
				score: evalResult.score,
				feedback: evalResult.feedback,
			});

			expect(evalResult.checks.isActionable).toBe(false);
		},
	);

	ls.test(
		"Non-actionable: no verification",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const recommendation: Recommendation = {
				id: "test-no-verify",
				title: "Change the database password",
				description:
					"The database password may have been compromised. " +
					"We should change it immediately.",
				category: "security" as any,
				priority: "critical",
				// No verification steps - how do we know it worked?
			};

			const evalResult = evaluateRecommendation(recommendation, {
				requireVerification: true,
			});

			ls.logOutputs({
				isActionable: evalResult.checks.isActionable,
				hasVerificationSteps: evalResult.checks.hasVerificationSteps,
				feedback: evalResult.feedback,
			});

			// With requireVerification, missing steps makes it not actionable
			expect(evalResult.checks.hasVerificationSteps).toBe(false);
		},
	);
});
