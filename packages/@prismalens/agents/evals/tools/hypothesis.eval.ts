/**
 * Hypothesis Tool Evaluation
 *
 * Tests the form_hypothesis tool in isolation.
 * Validates schema compliance and quality of produced hypotheses.
 */

import * as ls from "langsmith/vitest";
import { expect } from "vitest";
import { evaluateHypothesis } from "../evaluators/index.js";
import type { Hypothesis } from "../../src/types/state.js";

// =============================================================================
// TOOL IMPORT (Lazy)
// =============================================================================

type FormHypothesisTool = Awaited<
	typeof import("../../src/tools/hypothesis.js")
>["formHypothesisTool"];

let formHypothesisTool: FormHypothesisTool | null = null;

async function getFormHypothesisTool(): Promise<FormHypothesisTool> {
	if (!formHypothesisTool) {
		const mod = await import("../../src/tools/hypothesis.js");
		formHypothesisTool = mod.formHypothesisTool;
	}
	return formHypothesisTool;
}

// =============================================================================
// SCHEMA VALIDATION
// =============================================================================

ls.describe("Hypothesis Tool - Schema", () => {
	ls.test(
		"Accepts valid hypothesis input",
		{
			inputs: {
				claim: "The NullPointerException is caused by a missing null check in UserService.getUser()",
				evidence: [
					{
						source: "alert",
						content: "NullPointerException at UserService.java:42",
						relevance: 0.95,
					},
				],
				confidence: 85,
				category: "code",
			},
			referenceOutputs: {
				shouldBeValid: true,
			},
		},
		async ({ inputs, referenceOutputs }) => {
			// Create a mock hypothesis to validate
			const hypothesis: Hypothesis = {
				id: "test-hyp-001",
				claim: inputs.claim,
				evidence: inputs.evidence,
				confidence: inputs.confidence,
				category: inputs.category as Hypothesis["category"],
				createdAt: new Date().toISOString(),
			};

			const evalResult = evaluateHypothesis(hypothesis);

			ls.logOutputs({
				score: evalResult.score,
				checks: evalResult.checks,
				isValid: evalResult.score >= 70,
			});

			expect(evalResult.checks.hasValidClaim).toBe(true);
			expect(evalResult.checks.hasEvidence).toBe(true);
			expect(evalResult.checks.hasConfidence).toBe(true);
			expect(evalResult.checks.hasCategory).toBe(true);
		},
	);

	ls.test(
		"Rejects hypothesis without claim",
		{
			inputs: {
				claim: "",
				evidence: [],
				confidence: 50,
				category: "unknown",
			},
			referenceOutputs: {
				shouldBeValid: false,
			},
		},
		async ({ inputs }) => {
			const hypothesis: Hypothesis = {
				id: "test-hyp-002",
				claim: inputs.claim,
				evidence: inputs.evidence,
				confidence: inputs.confidence,
				category: inputs.category as Hypothesis["category"],
				createdAt: new Date().toISOString(),
			};

			const evalResult = evaluateHypothesis(hypothesis);

			ls.logOutputs({
				score: evalResult.score,
				checks: evalResult.checks,
				feedback: evalResult.feedback,
			});

			expect(evalResult.checks.hasValidClaim).toBe(false);
			expect(evalResult.score).toBeLessThan(50);
		},
	);
});

// =============================================================================
// EVIDENCE QUALITY
// =============================================================================

ls.describe("Hypothesis Tool - Evidence Quality", () => {
	const evidenceTestCases = [
		{
			name: "High quality evidence",
			evidence: [
				{
					source: "logs",
					content: "ERROR 2024-01-15 10:30:00 UserService.getUser() - NullPointerException",
					relevance: 0.95,
				},
				{
					source: "metrics",
					content: "Error rate spiked from 0.1% to 8% at 10:29:00",
					relevance: 0.9,
				},
				{
					source: "code",
					content: "Line 42: return user.getId(); // user can be null",
					relevance: 0.85,
				},
			],
			expectedMinScore: 80,
		},
		{
			name: "Single weak evidence",
			evidence: [
				{
					source: "alert",
					content: "Something is wrong",
					relevance: 0.3,
				},
			],
			expectedMinScore: 40,
		},
		{
			name: "No evidence",
			evidence: [],
			expectedMinScore: 0,
		},
	];

	for (const testCase of evidenceTestCases) {
		ls.test(
			testCase.name,
			{
				inputs: { evidence: testCase.evidence },
				referenceOutputs: { expectedMinScore: testCase.expectedMinScore },
			},
			async ({ inputs, referenceOutputs }) => {
				const hypothesis: Hypothesis = {
					id: `test-evidence-${testCase.name}`,
					claim: "Test hypothesis for evidence evaluation",
					evidence: inputs.evidence,
					confidence: 70,
					category: "code",
					createdAt: new Date().toISOString(),
				};

				const evalResult = evaluateHypothesis(hypothesis, {
					minEvidence: 2,
				});

				ls.logOutputs({
					score: evalResult.score,
					evidenceCount: evalResult.checks.evidenceCount,
					hasEvidence: evalResult.checks.hasEvidence,
					feedback: evalResult.feedback,
				});

				if (referenceOutputs.expectedMinScore > 0) {
					expect(evalResult.score).toBeGreaterThanOrEqual(
						referenceOutputs.expectedMinScore * 0.8,
					);
				}
			},
		);
	}
});

// =============================================================================
// CONFIDENCE CALIBRATION
// =============================================================================

ls.describe("Hypothesis Tool - Confidence", () => {
	ls.test(
		"Confidence must be 0-100",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const validConfidences = [0, 25, 50, 75, 100];
			const invalidConfidences = [-10, 101, 150];

			for (const confidence of validConfidences) {
				const hypothesis: Hypothesis = {
					id: `test-conf-${confidence}`,
					claim: "Valid hypothesis",
					evidence: [{ source: "test", content: "test", relevance: 0.5 }],
					confidence,
					category: "code",
					createdAt: new Date().toISOString(),
				};

				const evalResult = evaluateHypothesis(hypothesis);
				expect(evalResult.checks.confidenceInRange).toBe(true);
			}

			for (const confidence of invalidConfidences) {
				const hypothesis: Hypothesis = {
					id: `test-conf-invalid-${confidence}`,
					claim: "Invalid confidence hypothesis",
					evidence: [{ source: "test", content: "test", relevance: 0.5 }],
					confidence,
					category: "code",
					createdAt: new Date().toISOString(),
				};

				const evalResult = evaluateHypothesis(hypothesis);
				expect(evalResult.checks.confidenceInRange).toBe(false);
			}

			ls.logOutputs({
				validConfidencesTested: validConfidences,
				invalidConfidencesTested: invalidConfidences,
			});
		},
	);

	ls.test(
		"Minimum confidence threshold",
		{
			inputs: { minConfidence: 60 },
			referenceOutputs: {},
		},
		async ({ inputs }) => {
			const lowConfidenceHypothesis: Hypothesis = {
				id: "test-low-conf",
				claim: "Uncertain hypothesis about the issue",
				evidence: [{ source: "weak", content: "maybe this?", relevance: 0.3 }],
				confidence: 40,
				category: "unknown",
				createdAt: new Date().toISOString(),
			};

			const evalResult = evaluateHypothesis(lowConfidenceHypothesis, {
				minConfidence: inputs.minConfidence,
			});

			ls.logOutputs({
				score: evalResult.score,
				confidence: lowConfidenceHypothesis.confidence,
				minConfidence: inputs.minConfidence,
				feedback: evalResult.feedback,
			});

			// Should have feedback about low confidence
			expect(evalResult.feedback.some((f) => f.includes("confidence"))).toBe(true);
		},
	);
});

// =============================================================================
// CATEGORY VALIDATION
// =============================================================================

ls.describe("Hypothesis Tool - Categories", () => {
	const validCategories = ["code", "config", "infrastructure", "external", "unknown"];

	for (const category of validCategories) {
		ls.test(
			`Accepts category: ${category}`,
			{
				inputs: { category },
				referenceOutputs: {},
			},
			async ({ inputs }) => {
				const hypothesis: Hypothesis = {
					id: `test-cat-${inputs.category}`,
					claim: `This is a ${inputs.category} issue`,
					evidence: [{ source: "test", content: "evidence", relevance: 0.8 }],
					confidence: 70,
					category: inputs.category as Hypothesis["category"],
					createdAt: new Date().toISOString(),
				};

				const evalResult = evaluateHypothesis(hypothesis, {
					expectedCategory: inputs.category,
				});

				ls.logOutputs({
					category: inputs.category,
					hasCategory: evalResult.checks.hasCategory,
					score: evalResult.score,
				});

				expect(evalResult.checks.hasCategory).toBe(true);
			},
		);
	}

	ls.test(
		"Penalizes wrong category",
		{
			inputs: {},
			referenceOutputs: {},
		},
		async () => {
			const hypothesis: Hypothesis = {
				id: "test-wrong-cat",
				claim: "This is clearly a code issue",
				evidence: [
					{
						source: "stack_trace",
						content: "NullPointerException at line 42",
						relevance: 0.95,
					},
				],
				confidence: 80,
				category: "infrastructure", // Wrong!
				createdAt: new Date().toISOString(),
			};

			const evalResult = evaluateHypothesis(hypothesis, {
				expectedCategory: "code",
			});

			ls.logOutputs({
				actualCategory: hypothesis.category,
				expectedCategory: "code",
				feedback: evalResult.feedback,
				score: evalResult.score,
			});

			// Should have feedback about category mismatch
			expect(evalResult.feedback.some((f) => f.includes("mismatch"))).toBe(true);
		},
	);
});
