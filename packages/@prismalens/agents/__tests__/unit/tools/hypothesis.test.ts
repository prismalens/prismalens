/**
 * Hypothesis Tool Unit Tests
 *
 * Tests for the Detective agent's hypothesis formation and evaluation tools.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createHypothesisTool,
	createEvaluateHypothesisTool,
	createDetectiveTools,
	resetHypothesisStore,
	getStoredHypotheses,
} from "../../../src/tools/hypothesis.js";

describe("Hypothesis Tool", () => {
	beforeEach(() => {
		// Reset store before each test for isolation
		resetHypothesisStore();
	});

	describe("createHypothesisTool", () => {
		it("should create a hypothesis with valid fields", async () => {
			const tool = createHypothesisTool();

			const result = await tool.invoke({
				claim: "Null pointer exception in auth handler",
				confidence: 85,
				evidence: [
					"Stack trace shows error at line 42",
					"Recent commit changed auth logic",
				],
				category: "code",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.hypothesis.claim).toBe("Null pointer exception in auth handler");
			expect(parsed.hypothesis.confidence).toBe(85);
			expect(parsed.hypothesis.confidenceLevel).toBe("MEDIUM");
			expect(parsed.hypothesis.category).toBe("code");
			expect(parsed.hypothesis.evidenceCount).toBe(2);

			// Verify stored
			const stored = getStoredHypotheses();
			expect(stored).toHaveLength(1);
			expect(stored[0].claim).toBe("Null pointer exception in auth handler");
		});

		it("should reject confidence > 100", async () => {
			const tool = createHypothesisTool();

			// Zod validation throws at the tool level for invalid schema
			await expect(
				tool.invoke({
					claim: "Test hypothesis",
					confidence: 150,
					evidence: ["Some evidence"],
					category: "code",
				})
			).rejects.toThrow();

			// Verify not stored
			const stored = getStoredHypotheses();
			expect(stored).toHaveLength(0);
		});

		it("should reject confidence < 0", async () => {
			const tool = createHypothesisTool();

			// Zod validation throws at the tool level for invalid schema
			await expect(
				tool.invoke({
					claim: "Test hypothesis",
					confidence: -10,
					evidence: ["Some evidence"],
					category: "code",
				})
			).rejects.toThrow();
		});

		it("should require at least one evidence item", async () => {
			const tool = createHypothesisTool();

			// Zod validation throws at the tool level for invalid schema
			await expect(
				tool.invoke({
					claim: "Test hypothesis",
					confidence: 80,
					evidence: [],
					category: "code",
				})
			).rejects.toThrow();
		});

		it("should provide guidance for low confidence", async () => {
			const tool = createHypothesisTool();

			const result = await tool.invoke({
				claim: "Possible correlation",
				confidence: 45,
				evidence: ["Weak evidence"],
				category: "unknown",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.hypothesis.confidenceLevel).toBe("VERY LOW");
			expect(parsed.guidance).toContain("gathering more evidence");
		});

		it("should provide guidance for high confidence", async () => {
			const tool = createHypothesisTool();

			const result = await tool.invoke({
				claim: "Definite root cause identified",
				confidence: 95,
				evidence: [
					"Direct stack trace",
					"Reproduction confirmed",
					"Code diff matches",
				],
				category: "code",
			});

			const parsed = JSON.parse(result);
			expect(parsed.hypothesis.confidenceLevel).toBe("HIGH");
			expect(parsed.guidance).toContain("Ready for fix proposal");
		});

		it("should track multiple hypotheses", async () => {
			const tool = createHypothesisTool();

			// First hypothesis
			await tool.invoke({
				claim: "Primary hypothesis",
				confidence: 80,
				evidence: ["Evidence 1"],
				category: "code",
			});

			// Second hypothesis
			const result = await tool.invoke({
				claim: "Alternative hypothesis",
				confidence: 60,
				evidence: ["Evidence 2"],
				category: "config",
			});

			const parsed = JSON.parse(result);
			expect(parsed.totalHypotheses).toBe(2);

			const stored = getStoredHypotheses();
			expect(stored).toHaveLength(2);
			expect(stored[0].claim).toBe("Primary hypothesis");
			expect(stored[1].claim).toBe("Alternative hypothesis");
		});

		it("should validate category values", async () => {
			const tool = createHypothesisTool();

			// Zod validation throws at the tool level for invalid enum value
			await expect(
				tool.invoke({
					claim: "Test hypothesis",
					confidence: 80,
					evidence: ["Evidence"],
					category: "invalid_category",
				})
			).rejects.toThrow();
		});

		it("should add timestamp to hypothesis", async () => {
			const tool = createHypothesisTool();

			await tool.invoke({
				claim: "Test hypothesis",
				confidence: 80,
				evidence: ["Evidence"],
				category: "code",
			});

			const stored = getStoredHypotheses();
			expect(stored[0].timestamp).toBeDefined();
			expect(new Date(stored[0].timestamp!).getTime()).toBeLessThanOrEqual(Date.now());
		});
	});

	describe("createEvaluateHypothesisTool", () => {
		beforeEach(async () => {
			// Create an initial hypothesis to evaluate
			const tool = createHypothesisTool();
			await tool.invoke({
				claim: "Initial hypothesis",
				confidence: 70,
				evidence: ["Initial evidence"],
				category: "code",
			});
		});

		it("should update hypothesis with new confidence", async () => {
			const evaluateTool = createEvaluateHypothesisTool();

			const result = await evaluateTool.invoke({
				hypothesisIndex: 0,
				newConfidence: 90,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("updated");
			expect(parsed.hypothesis.confidence).toBe(90);

			const stored = getStoredHypotheses();
			expect(stored[0].confidence).toBe(90);
		});

		it("should add additional evidence", async () => {
			const evaluateTool = createEvaluateHypothesisTool();

			const result = await evaluateTool.invoke({
				hypothesisIndex: 0,
				additionalEvidence: ["New evidence 1", "New evidence 2"],
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("updated");
			expect(parsed.hypothesis.evidenceCount).toBe(3);

			const stored = getStoredHypotheses();
			expect(stored[0].evidence).toContain("New evidence 1");
			expect(stored[0].evidence).toContain("New evidence 2");
		});

		it("should reject hypothesis with reason", async () => {
			const evaluateTool = createEvaluateHypothesisTool();

			const result = await evaluateTool.invoke({
				hypothesisIndex: 0,
				rejected: true,
				rejectionReason: "Evidence disproved by timeline analysis",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("rejected");
			expect(parsed.hypothesis.reason).toBe("Evidence disproved by timeline analysis");

			const stored = getStoredHypotheses();
			expect(stored[0].confidence).toBe(0);
			expect(stored[0].evidence.some((e: string) => e.includes("REJECTED"))).toBe(true);
		});

		it("should handle invalid hypothesis index", async () => {
			const evaluateTool = createEvaluateHypothesisTool();

			const result = await evaluateTool.invoke({
				hypothesisIndex: 5,
				newConfidence: 90,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("error");
			expect(parsed.error).toContain("Invalid hypothesis index");
		});

		it("should handle negative hypothesis index", async () => {
			const evaluateTool = createEvaluateHypothesisTool();

			const result = await evaluateTool.invoke({
				hypothesisIndex: -1,
				newConfidence: 90,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("error");
		});
	});

	describe("createDetectiveTools", () => {
		it("should return both hypothesis tools", () => {
			const tools = createDetectiveTools();

			expect(tools).toHaveLength(2);
			expect(tools.map((t) => t.name)).toContain("form_hypothesis");
			expect(tools.map((t) => t.name)).toContain("evaluate_hypothesis");
		});
	});

	describe("Store management", () => {
		it("should reset store correctly", async () => {
			const tool = createHypothesisTool();

			await tool.invoke({
				claim: "Test hypothesis",
				confidence: 80,
				evidence: ["Evidence"],
				category: "code",
			});

			expect(getStoredHypotheses()).toHaveLength(1);

			resetHypothesisStore();

			expect(getStoredHypotheses()).toHaveLength(0);
		});

		it("should return a copy of stored hypotheses", async () => {
			const tool = createHypothesisTool();

			await tool.invoke({
				claim: "Test hypothesis",
				confidence: 80,
				evidence: ["Evidence"],
				category: "code",
			});

			const stored1 = getStoredHypotheses();
			const stored2 = getStoredHypotheses();

			// Should be different array instances
			expect(stored1).not.toBe(stored2);
			// But same content
			expect(stored1).toEqual(stored2);

			// Modifying returned array shouldn't affect store
			stored1.push({ claim: "Fake", confidence: 0, evidence: [] });
			expect(getStoredHypotheses()).toHaveLength(1);
		});
	});

	describe("Confidence level mapping", () => {
		it.each([
			[100, "HIGH"],
			[95, "HIGH"],
			[90, "HIGH"],
			[89, "MEDIUM"],
			[75, "MEDIUM"],
			[70, "MEDIUM"],
			[69, "LOW"],
			[55, "LOW"],
			[50, "LOW"],
			[49, "VERY LOW"],
			[25, "VERY LOW"],
			[0, "VERY LOW"],
		])("confidence %i should map to %s", async (confidence, expectedLevel) => {
			const tool = createHypothesisTool();
			resetHypothesisStore();

			const result = await tool.invoke({
				claim: "Test hypothesis",
				confidence,
				evidence: ["Evidence"],
				category: "code",
			});

			const parsed = JSON.parse(result);
			expect(parsed.hypothesis.confidenceLevel).toBe(expectedLevel);
		});
	});
});
