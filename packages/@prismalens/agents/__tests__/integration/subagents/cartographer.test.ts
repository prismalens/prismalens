/**
 * Cartographer SubAgent Integration Tests
 *
 * Tests for the context-gathering agent with mocked integrations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	createCartographerSubAgent,
	type SubAgentConfig,
} from "../../../src/agents/subagents/index.js";
import { createGitHubIntegration, createRenderIntegration } from "../../factories/integration.factory.js";

describe("Cartographer SubAgent", () => {
	let config: SubAgentConfig;

	beforeEach(() => {
		config = {
			integrations: [
				createGitHubIntegration(),
				createRenderIntegration(),
			],
			enableSkills: false, // Disable skills for unit testing
		};
	});

	describe("SubAgent Creation", () => {
		it("should create subagent with correct name and description", () => {
			const cartographer = createCartographerSubAgent(config);

			expect(cartographer.name).toBe("cartographer");
			expect(cartographer.description).toContain("Gathers all relevant context");
			expect(cartographer.description).toContain("READ-ONLY");
		});

		it("should have system prompt with key instructions", () => {
			const cartographer = createCartographerSubAgent(config);

			expect(cartographer.systemPrompt).toContain("READ-ONLY");
			expect(cartographer.systemPrompt).toContain("context gathering");
			expect(cartographer.systemPrompt).toContain("Error Context");
			expect(cartographer.systemPrompt).toContain("Recent Changes");
		});

		it("should create correct tools based on integrations", () => {
			const cartographer = createCartographerSubAgent(config);

			// Should have tools from both GitHub and Render integrations
			expect(cartographer.tools).toBeDefined();
			expect(cartographer.tools!.length).toBeGreaterThan(0);

			const toolNames = cartographer.tools!.map((t) => t.name);
			// GitHub tools
			expect(toolNames.some((n) => n.includes("github"))).toBe(true);
			// Render tools
			expect(toolNames.some((n) => n.includes("render"))).toBe(true);
		});

		it("should include GitHub tools when GitHub integration is provided", () => {
			const githubOnlyConfig: SubAgentConfig = {
				integrations: [createGitHubIntegration()],
				enableSkills: false,
			};

			const cartographer = createCartographerSubAgent(githubOnlyConfig);
			const toolNames = cartographer.tools!.map((t) => t.name);

			// GitHub tools should be present
			expect(toolNames.some((n) => n.includes("github"))).toBe(true);
			// Repo tools (local) should also be present as they don't need integrations
			expect(toolNames.some((n) => n.includes("repo") || n.includes("file") || n.includes("search"))).toBe(true);
		});

		it("should include Render tools when Render integration is provided", () => {
			const renderOnlyConfig: SubAgentConfig = {
				integrations: [createRenderIntegration()],
				enableSkills: false,
			};

			const cartographer = createCartographerSubAgent(renderOnlyConfig);
			const toolNames = cartographer.tools!.map((t) => t.name);

			// Render tools should be present
			expect(toolNames.some((n) => n.includes("render"))).toBe(true);
			// Repo tools (local) should also be present
			expect(toolNames.length).toBeGreaterThan(0);
		});

		it("should handle empty integrations", () => {
			const emptyConfig: SubAgentConfig = {
				integrations: [],
				enableSkills: false,
			};

			const cartographer = createCartographerSubAgent(emptyConfig);

			// Should still create subagent, just with no tools
			expect(cartographer.name).toBe("cartographer");
			expect(cartographer.tools).toBeDefined();
		});
	});

	describe("Model Configuration", () => {
		it("should use custom model when specified", () => {
			const configWithModel: SubAgentConfig = {
				...config,
				models: {
					cartographer: "gpt-4-turbo",
				},
			};

			const cartographer = createCartographerSubAgent(configWithModel);

			expect(cartographer.model).toBe("gpt-4-turbo");
		});

		it("should use environment variable when no model specified", () => {
			const originalEnv = process.env.CARTOGRAPHER_MODEL;
			process.env.CARTOGRAPHER_MODEL = "claude-3-5-sonnet-latest";

			const cartographer = createCartographerSubAgent({
				integrations: [],
				enableSkills: false,
			});

			expect(cartographer.model).toBe("claude-3-5-sonnet-latest");

			// Restore
			if (originalEnv) {
				process.env.CARTOGRAPHER_MODEL = originalEnv;
			} else {
				delete process.env.CARTOGRAPHER_MODEL;
			}
		});
	});

	describe("Skills Middleware", () => {
		it("should include skills middleware when enabled", () => {
			const configWithSkills: SubAgentConfig = {
				integrations: [],
				enableSkills: true,
			};

			const cartographer = createCartographerSubAgent(configWithSkills);

			// Should have middleware array when skills enabled
			expect(cartographer.middleware).toBeDefined();
			expect(cartographer.middleware!.length).toBeGreaterThan(0);
		});

		it("should not include middleware when skills disabled", () => {
			const configWithoutSkills: SubAgentConfig = {
				integrations: [],
				enableSkills: false,
			};

			const cartographer = createCartographerSubAgent(configWithoutSkills);

			expect(cartographer.middleware).toBeUndefined();
		});

		it("should include skills middleware by default", () => {
			const defaultConfig: SubAgentConfig = {
				integrations: [],
				// enableSkills not specified, should default to true
			};

			const cartographer = createCartographerSubAgent(defaultConfig);

			expect(cartographer.middleware).toBeDefined();
		});
	});

	describe("Tool Categories", () => {
		it("should only have read-only tools", () => {
			const cartographer = createCartographerSubAgent(config);
			const toolNames = cartographer.tools!.map((t) => t.name);

			// Should not have write/create/delete tools
			const writeOperations = ["create", "write", "delete", "update", "modify"];
			for (const tool of toolNames) {
				for (const op of writeOperations) {
					expect(tool.toLowerCase().includes(op)).toBe(false);
				}
			}
		});
	});
});
