/**
 * Fix Proposal Tool Unit Tests
 *
 * Tests for the Surgeon agent's fix proposal and validation tools.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createProposeFixTool,
	createValidateCodeChangeTool,
	createSuggestRollbackTool,
	createSurgeonTools,
	resetRecommendationStore,
	getStoredRecommendations,
} from "../../../src/tools/fix-proposal.js";

describe("Fix Proposal Tool", () => {
	beforeEach(() => {
		resetRecommendationStore();
	});

	describe("createProposeFixTool", () => {
		it("should create a code fix recommendation", async () => {
			const tool = createProposeFixTool();

			const result = await tool.invoke({
				title: "Fix null pointer in auth handler",
				description: "Add null check before accessing user properties",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
				estimatedEffort: "minutes",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.recommendation.title).toBe("Fix null pointer in auth handler");
			expect(parsed.recommendation.priority).toBe("high");
			expect(parsed.recommendation.category).toBe("code_fix");
			expect(parsed.recommendation.urgency).toBe("immediate");

			const stored = getStoredRecommendations();
			expect(stored).toHaveLength(1);
			expect(stored[0].actionable).toBe(true);
		});

		it("should create a config change recommendation", async () => {
			const tool = createProposeFixTool();

			const result = await tool.invoke({
				title: "Set DATABASE_URL environment variable",
				priority: "critical",
				category: "config_change",
				urgency: "immediate",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.recommendation.category).toBe("config_change");

			const stored = getStoredRecommendations();
			expect(stored[0].category).toBe("config_change");
		});

		it("should create a rollback recommendation", async () => {
			const tool = createProposeFixTool();

			const result = await tool.invoke({
				title: "Rollback to previous deployment",
				description: "Revert to deployment dep-000005",
				priority: "critical",
				category: "rollback",
				urgency: "immediate",
			});

			const parsed = JSON.parse(result);
			expect(parsed.recommendation.category).toBe("rollback");
		});

		it("should validate search/replace blocks in code changes", async () => {
			const tool = createProposeFixTool();

			const result = await tool.invoke({
				title: "Fix null check",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
				codeChanges: [
					{
						filePath: "src/services/auth-handler.ts",
						searchBlock: "return user.id.toString();",
						replaceBlock: `if (!user) {
  throw new Error('User is required');
}
return user.id.toString();`,
						testCase: "Run npm test -- auth.test.ts",
					},
				],
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.codeChanges).toBeDefined();
			expect(parsed.codeChanges.count).toBe(1);
			expect(parsed.codeChanges.files).toContain("src/services/auth-handler.ts");

			const stored = getStoredRecommendations();
			expect(stored[0].codeChanges).toHaveLength(1);
			expect(stored[0].codeChanges![0].filePath).toBe("src/services/auth-handler.ts");
		});

		it("should require test case for code fixes", async () => {
			const tool = createProposeFixTool();

			// Zod validation throws at the tool level for missing required field
			await expect(
				tool.invoke({
					title: "Fix null check",
					priority: "high",
					category: "code_fix",
					urgency: "immediate",
					codeChanges: [
						{
							filePath: "src/services/auth-handler.ts",
							searchBlock: "old code",
							replaceBlock: "new code",
							// Missing testCase - will throw
						},
					],
				})
			).rejects.toThrow();
		});

		it("should provide guidance for code_fix without code changes", async () => {
			const tool = createProposeFixTool();

			const result = await tool.invoke({
				title: "Fix the bug",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
			});

			const parsed = JSON.parse(result);
			expect(parsed.guidance).toContain("adding specific codeChanges");
		});

		it("should handle multiple code changes", async () => {
			const tool = createProposeFixTool();

			const result = await tool.invoke({
				title: "Fix multiple files",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
				codeChanges: [
					{
						filePath: "src/file1.ts",
						searchBlock: "old1",
						replaceBlock: "new1",
						testCase: "test1",
					},
					{
						filePath: "src/file2.ts",
						searchBlock: "old2",
						replaceBlock: "new2",
						testCase: "test2",
					},
				],
			});

			const parsed = JSON.parse(result);
			expect(parsed.codeChanges.count).toBe(2);
			expect(parsed.codeChanges.files).toContain("src/file1.ts");
			expect(parsed.codeChanges.files).toContain("src/file2.ts");
		});

		it("should reject invalid priority", async () => {
			const tool = createProposeFixTool();

			// Zod validation throws at the tool level for invalid enum value
			await expect(
				tool.invoke({
					title: "Test fix",
					priority: "invalid_priority",
					category: "code_fix",
					urgency: "immediate",
				})
			).rejects.toThrow();
		});

		it("should reject invalid category", async () => {
			const tool = createProposeFixTool();

			// Zod validation throws at the tool level for invalid enum value
			await expect(
				tool.invoke({
					title: "Test fix",
					priority: "high",
					category: "invalid_category",
					urgency: "immediate",
				})
			).rejects.toThrow();
		});

		it("should track multiple recommendations", async () => {
			const tool = createProposeFixTool();

			await tool.invoke({
				title: "First fix",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
			});

			const result = await tool.invoke({
				title: "Second fix",
				priority: "medium",
				category: "monitoring",
				urgency: "short_term",
			});

			const parsed = JSON.parse(result);
			expect(parsed.totalRecommendations).toBe(2);

			const stored = getStoredRecommendations();
			expect(stored).toHaveLength(2);
		});

		it("should enforce title max length", async () => {
			const tool = createProposeFixTool();

			// Zod validation throws at the tool level for string length violation
			await expect(
				tool.invoke({
					title: "A".repeat(150), // Exceeds 100 character limit
					priority: "high",
					category: "code_fix",
					urgency: "immediate",
				})
			).rejects.toThrow();
		});
	});

	describe("createValidateCodeChangeTool", () => {
		beforeEach(async () => {
			// Create a recommendation with code changes to validate
			const tool = createProposeFixTool();
			await tool.invoke({
				title: "Fix with code changes",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
				codeChanges: [
					{
						filePath: "src/test.ts",
						searchBlock: "old code",
						replaceBlock: "new code",
						testCase: "run tests",
					},
				],
			});
		});

		it("should validate code change successfully", async () => {
			const validateTool = createValidateCodeChangeTool();

			const result = await validateTool.invoke({
				recommendationIndex: 0,
				codeChangeIndex: 0,
				searchFound: true,
				syntaxValid: true,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("validated");
			expect(parsed.validationStatus).toBe("VALIDATED");
			expect(parsed.codeChange.searchFound).toBe(true);
			expect(parsed.codeChange.syntaxValid).toBe(true);
		});

		it("should mark needs review when search not found", async () => {
			const validateTool = createValidateCodeChangeTool();

			const result = await validateTool.invoke({
				recommendationIndex: 0,
				codeChangeIndex: 0,
				searchFound: false,
				syntaxValid: true,
				notes: "Search block not found in file",
			});

			const parsed = JSON.parse(result);
			expect(parsed.validationStatus).toBe("NEEDS_REVIEW");
			expect(parsed.notes).toBe("Search block not found in file");
		});

		it("should handle invalid recommendation index", async () => {
			const validateTool = createValidateCodeChangeTool();

			const result = await validateTool.invoke({
				recommendationIndex: 5,
				codeChangeIndex: 0,
				searchFound: true,
				syntaxValid: true,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("error");
			expect(parsed.error).toContain("Invalid recommendation index");
		});

		it("should handle recommendation without code changes", async () => {
			// Create a recommendation without code changes
			const proposeTool = createProposeFixTool();
			await proposeTool.invoke({
				title: "No code changes",
				priority: "medium",
				category: "config_change",
				urgency: "short_term",
			});

			const validateTool = createValidateCodeChangeTool();
			const result = await validateTool.invoke({
				recommendationIndex: 1, // Second recommendation
				codeChangeIndex: 0,
				searchFound: true,
				syntaxValid: true,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("error");
			expect(parsed.error).toContain("no code changes");
		});

		it("should handle invalid code change index", async () => {
			const validateTool = createValidateCodeChangeTool();

			const result = await validateTool.invoke({
				recommendationIndex: 0,
				codeChangeIndex: 5, // Invalid index
				searchFound: true,
				syntaxValid: true,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("error");
			expect(parsed.error).toContain("Invalid code change index");
		});
	});

	describe("createSuggestRollbackTool", () => {
		it("should create rollback recommendation", async () => {
			const tool = createSuggestRollbackTool();

			const result = await tool.invoke({
				service: "api-service",
				deploymentId: "dep-000005",
				reason: "Error rate spike after latest deployment",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.recommendation.title).toContain("Rollback api-service");
			expect(parsed.recommendation.priority).toBe("high");
			expect(parsed.recommendation.urgency).toBe("immediate");
			expect(parsed.recommendation.rollbackTarget).toBe("dep-000005");

			const stored = getStoredRecommendations();
			expect(stored[0].category).toBe("rollback");
			expect(stored[0].description).toContain("dep-000005");
		});

		it("should handle rollback with commit SHA", async () => {
			const tool = createSuggestRollbackTool();

			const result = await tool.invoke({
				service: "api-service",
				commitSha: "abc123def456",
				reason: "Regression in latest commit",
			});

			const parsed = JSON.parse(result);
			expect(parsed.recommendation.rollbackTarget).toBe("abc123def456");

			const stored = getStoredRecommendations();
			expect(stored[0].description).toContain("abc123def456");
		});

		it("should require service name", async () => {
			const tool = createSuggestRollbackTool();

			// This should fail schema validation since service is required
			await expect(
				tool.invoke({
					deploymentId: "dep-000005",
					reason: "Error rate spike",
				})
			).rejects.toThrow();
		});
	});

	describe("createSurgeonTools", () => {
		it("should return all surgeon tools", () => {
			const tools = createSurgeonTools();

			expect(tools).toHaveLength(3);
			expect(tools.map((t) => t.name)).toContain("propose_fix");
			expect(tools.map((t) => t.name)).toContain("validate_code_change");
			expect(tools.map((t) => t.name)).toContain("suggest_rollback");
		});
	});

	describe("Store management", () => {
		it("should reset store correctly", async () => {
			const tool = createProposeFixTool();

			await tool.invoke({
				title: "Test fix",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
			});

			expect(getStoredRecommendations()).toHaveLength(1);

			resetRecommendationStore();

			expect(getStoredRecommendations()).toHaveLength(0);
		});

		it("should return a copy of stored recommendations", async () => {
			const tool = createProposeFixTool();

			await tool.invoke({
				title: "Test fix",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
			});

			const stored1 = getStoredRecommendations();
			const stored2 = getStoredRecommendations();

			// Should be different array instances
			expect(stored1).not.toBe(stored2);
			// But same content
			expect(stored1).toEqual(stored2);
		});
	});

	describe("Priority and urgency combinations", () => {
		it.each([
			["critical", "immediate"],
			["high", "immediate"],
			["high", "short_term"],
			["medium", "short_term"],
			["low", "long_term"],
		])("should accept priority %s with urgency %s", async (priority, urgency) => {
			const tool = createProposeFixTool();
			resetRecommendationStore();

			const result = await tool.invoke({
				title: "Test fix",
				priority,
				category: "code_fix",
				urgency,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
		});
	});

	describe("Estimated effort", () => {
		it.each(["minutes", "hours", "days"])("should accept estimated effort: %s", async (effort) => {
			const tool = createProposeFixTool();
			resetRecommendationStore();

			const result = await tool.invoke({
				title: "Test fix",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
				estimatedEffort: effort,
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");

			const stored = getStoredRecommendations();
			expect(stored[0].estimatedEffort).toBe(effort);
		});
	});
});
