/**
 * Detective SubAgent Integration Tests
 *
 * Tests for the root cause analysis agent.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createDetectiveSubAgent,
	type SubAgentConfig,
} from "../../../src/agents/subagents/index.js";
import { resetHypothesisStore } from "../../../src/tools/hypothesis.js";

describe("Detective SubAgent", () => {
	let config: SubAgentConfig;

	beforeEach(() => {
		config = {
			integrations: [], // Detective doesn't use external integrations
			enableSkills: false,
		};
		resetHypothesisStore();
	});

	describe("SubAgent Creation", () => {
		it("should create subagent with correct name and description", () => {
			const detective = createDetectiveSubAgent(config);

			expect(detective.name).toBe("detective");
			expect(detective.description).toContain("root cause");
			expect(detective.description).toContain("hypotheses");
		});

		it("should have system prompt with analysis framework", () => {
			const detective = createDetectiveSubAgent(config);

			expect(detective.systemPrompt).toContain("Timeline Analysis");
			expect(detective.systemPrompt).toContain("Error Analysis");
			expect(detective.systemPrompt).toContain("Pattern Recognition");
			expect(detective.systemPrompt).toContain("Confidence Guidelines");
		});

		it("should have hypothesis formation tools", () => {
			const detective = createDetectiveSubAgent(config);

			const toolNames = detective.tools!.map((t) => t.name);
			expect(toolNames).toContain("form_hypothesis");
			expect(toolNames).toContain("evaluate_hypothesis");
		});

		it("should have exactly two tools (form and evaluate hypothesis)", () => {
			const detective = createDetectiveSubAgent(config);

			expect(detective.tools).toHaveLength(2);
		});
	});

	describe("Hypothesis Tool Integration", () => {
		it("should be able to invoke hypothesis tool", async () => {
			const detective = createDetectiveSubAgent(config);
			const hypothesisTool = detective.tools!.find(
				(t) => t.name === "form_hypothesis"
			);

			expect(hypothesisTool).toBeDefined();

			const result = await hypothesisTool!.invoke({
				claim: "Null pointer in auth handler",
				confidence: 85,
				evidence: ["Stack trace at line 42"],
				category: "code",
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("recorded");
		});

		it("should be able to invoke evaluate hypothesis tool", async () => {
			const detective = createDetectiveSubAgent(config);
			const hypothesisTool = detective.tools!.find(
				(t) => t.name === "form_hypothesis"
			);
			const evaluateTool = detective.tools!.find(
				(t) => t.name === "evaluate_hypothesis"
			);

			// First create a hypothesis
			await hypothesisTool!.invoke({
				claim: "Initial hypothesis",
				confidence: 70,
				evidence: ["Evidence"],
				category: "code",
			});

			// Then evaluate it
			const result = await evaluateTool!.invoke({
				hypothesisIndex: 0,
				newConfidence: 90,
				additionalEvidence: ["More evidence found"],
			});

			const parsed = JSON.parse(result);
			expect(parsed.status).toBe("updated");
			expect(parsed.hypothesis.confidence).toBe(90);
		});
	});

	describe("Model Configuration", () => {
		it("should use custom model when specified", () => {
			const configWithModel: SubAgentConfig = {
				...config,
				models: {
					detective: "claude-3-5-sonnet-latest",
				},
			};

			const detective = createDetectiveSubAgent(configWithModel);

			expect(detective.model).toBe("claude-3-5-sonnet-latest");
		});

		it("should use environment variable when no model specified", () => {
			const originalEnv = process.env.DETECTIVE_MODEL;
			process.env.DETECTIVE_MODEL = "gpt-4o";

			const detective = createDetectiveSubAgent({
				integrations: [],
				enableSkills: false,
			});

			expect(detective.model).toBe("gpt-4o");

			// Restore
			if (originalEnv) {
				process.env.DETECTIVE_MODEL = originalEnv;
			} else {
				delete process.env.DETECTIVE_MODEL;
			}
		});
	});

	describe("Skills Middleware", () => {
		it("should include skills middleware when enabled", () => {
			const configWithSkills: SubAgentConfig = {
				integrations: [],
				enableSkills: true,
			};

			const detective = createDetectiveSubAgent(configWithSkills);

			expect(detective.middleware).toBeDefined();
			expect(detective.middleware!.length).toBeGreaterThan(0);
		});

		it("should not include middleware when skills disabled", () => {
			const detective = createDetectiveSubAgent(config);

			expect(detective.middleware).toBeUndefined();
		});
	});

	describe("System Prompt Guidelines", () => {
		it("should include confidence level guidelines", () => {
			const detective = createDetectiveSubAgent(config);

			expect(detective.systemPrompt).toContain("90-100%");
			expect(detective.systemPrompt).toContain("70-89%");
			expect(detective.systemPrompt).toContain("50-69%");
			expect(detective.systemPrompt).toContain("Below 50%");
		});

		it("should include category definitions", () => {
			const detective = createDetectiveSubAgent(config);

			expect(detective.systemPrompt).toContain("code");
			expect(detective.systemPrompt).toContain("config");
			expect(detective.systemPrompt).toContain("infrastructure");
			expect(detective.systemPrompt).toContain("external");
		});
	});
});
