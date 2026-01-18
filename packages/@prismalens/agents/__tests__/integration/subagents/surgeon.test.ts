/**
 * Surgeon SubAgent Integration Tests
 *
 * Tests for the fix proposal agent.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createSurgeonSubAgent,
	type SubAgentConfig,
} from "../../../src/agents/subagents/index.js";
import { resetRecommendationStore } from "../../../src/tools/fix-proposal.js";

describe("Surgeon SubAgent", () => {
	let config: SubAgentConfig;

	beforeEach(() => {
		config = {
			integrations: [], // Surgeon doesn't use external integrations for tools
			enableSkills: false,
		};
		resetRecommendationStore();
	});

	describe("SubAgent Creation", () => {
		it("should create subagent with correct name and description", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.name).toBe("surgeon");
			expect(surgeon.description).toContain("Proposes fixes");
			expect(surgeon.description).toContain("human review");
		});

		it("should have system prompt with fix guidelines", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.systemPrompt).toContain("Code Fixes");
			expect(surgeon.systemPrompt).toContain("Configuration Changes");
			expect(surgeon.systemPrompt).toContain("Rollbacks");
			expect(surgeon.systemPrompt).toContain("Priority Guidelines");
		});

		it("should have fix proposal tools", () => {
			const surgeon = createSurgeonSubAgent(config);

			const toolNames = surgeon.tools!.map((t) => t.name);
			expect(toolNames).toContain("propose_fix");
			expect(toolNames).toContain("validate_code_change");
			expect(toolNames).toContain("suggest_rollback");
		});

		it("should have exactly three tools", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.tools).toHaveLength(3);
		});
	});

	describe("Fix Proposal Tool Integration", () => {
		it("should be able to invoke propose_fix tool", async () => {
			const surgeon = createSurgeonSubAgent(config);
			const proposeTool = surgeon.tools!.find((t) => t.name === "propose_fix");

			expect(proposeTool).toBeDefined();

			const result = await proposeTool!.invoke({
				title: "Fix null check in auth handler",
				description: "Add null check before accessing user properties",
				priority: "high",
				category: "code_fix",
				urgency: "immediate",
				codeChanges: [
					{
						filePath: "src/services/auth-handler.ts",
						searchBlock: "return user.id;",
						replaceBlock: "return user?.id ?? null;",
						testCase: "Run auth tests",
					},
				],
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.codeChanges).toBeDefined();
		});

		it("should be able to invoke suggest_rollback tool", async () => {
			const surgeon = createSurgeonSubAgent(config);
			const rollbackTool = surgeon.tools!.find(
				(t) => t.name === "suggest_rollback"
			);

			expect(rollbackTool).toBeDefined();

			const result = await rollbackTool!.invoke({
				service: "api-service",
				deploymentId: "dep-12345",
				reason: "Error rate spike after deployment",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
			expect(parsed.recommendation.urgency).toBe("immediate");
		});
	});

	describe("Model Configuration", () => {
		it("should use custom model when specified", () => {
			const configWithModel: SubAgentConfig = {
				...config,
				models: {
					surgeon: "gpt-4-turbo",
				},
			};

			const surgeon = createSurgeonSubAgent(configWithModel);

			expect(surgeon.model).toBe("gpt-4-turbo");
		});

		it("should use environment variable when no model specified", () => {
			const originalEnv = process.env.SURGEON_MODEL;
			process.env.SURGEON_MODEL = "claude-3-5-sonnet-latest";

			const surgeon = createSurgeonSubAgent({
				integrations: [],
				enableSkills: false,
			});

			expect(surgeon.model).toBe("claude-3-5-sonnet-latest");

			// Restore
			if (originalEnv) {
				process.env.SURGEON_MODEL = originalEnv;
			} else {
				delete process.env.SURGEON_MODEL;
			}
		});
	});

	describe("Skills Middleware", () => {
		it("should include skills middleware when enabled", () => {
			const configWithSkills: SubAgentConfig = {
				integrations: [],
				enableSkills: true,
			};

			const surgeon = createSurgeonSubAgent(configWithSkills);

			expect(surgeon.middleware).toBeDefined();
			expect(surgeon.middleware!.length).toBeGreaterThan(0);
		});

		it("should not include middleware when skills disabled", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.middleware).toBeUndefined();
		});
	});

	describe("System Prompt Constraints", () => {
		it("should emphasize proposal-only nature", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.systemPrompt).toContain("PROPOSE fixes only");
			expect(surgeon.systemPrompt).toContain("do NOT implement");
			expect(surgeon.systemPrompt).toContain("HUMAN REVIEW");
		});

		it("should include priority guidelines", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.systemPrompt).toContain("critical");
			expect(surgeon.systemPrompt).toContain("high");
			expect(surgeon.systemPrompt).toContain("medium");
			expect(surgeon.systemPrompt).toContain("low");
		});

		it("should include best practices", () => {
			const surgeon = createSurgeonSubAgent(config);

			expect(surgeon.systemPrompt).toContain("One recommendation per distinct issue");
			expect(surgeon.systemPrompt).toContain("test/verification steps");
			expect(surgeon.systemPrompt).toContain("side effects");
		});
	});
});
