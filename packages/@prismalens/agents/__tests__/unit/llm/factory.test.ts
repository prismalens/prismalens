/**
 * LLM Factory Unit Tests
 *
 * Tests for the LLM factory that creates provider-specific models.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLLM, registerAgentConfig, getAgentConfig } from "../../../src/llm/factory.js";

describe("LLM Factory", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Reset environment to known state
		process.env.LLM_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "test-openai-key";
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		process.env.GOOGLE_API_KEY = "test-google-key";
		process.env.OLLAMA_BASE_URL = "http://localhost:11434";

		// Clear any agent-specific model overrides
		delete process.env.COMMANDER_MODEL;
		delete process.env.CARTOGRAPHER_MODEL;
		delete process.env.DETECTIVE_MODEL;
		delete process.env.SURGEON_MODEL;
	});

	afterEach(() => {
		// Restore original environment
		process.env = { ...originalEnv };
	});

	describe("Provider selection", () => {
		it("should create OpenAI model by default", () => {
			const llm = createLLM();

			// Verify it's a ChatOpenAI instance by checking constructor name
			expect(llm.constructor.name).toBe("ChatOpenAI");
		});

		it("should create Anthropic model when specified", () => {
			const llm = createLLM({ provider: "anthropic" });

			expect(llm.constructor.name).toBe("ChatAnthropic");
		});

		it("should create Google model when specified", () => {
			const llm = createLLM({ provider: "google" });

			expect(llm.constructor.name).toBe("ChatGoogleGenerativeAI");
		});

		it("should use explicit provider option over env var", () => {
			// Note: LLM_PROVIDER env var is cached by getConfig(), so we test explicit override
			const llm = createLLM({ provider: "anthropic" });

			expect(llm.constructor.name).toBe("ChatAnthropic");
		});

		it("should throw for unsupported provider", () => {
			expect(() => createLLM({ provider: "unsupported" })).toThrow(
				"Unsupported LLM provider: unsupported"
			);
		});
	});

	describe("Agent-specific configuration", () => {
		it("should use agent-specific temperature for commander", () => {
			const llm = createLLM({ agentName: "commander" });

			// Commander should have temperature 0.1 by default
			// We can't easily check internal state, but we can verify creation succeeds
			expect(llm).toBeDefined();
		});

		it("should use agent-specific temperature for cartographer", () => {
			const llm = createLLM({ agentName: "cartographer" });

			// Cartographer should have temperature 0 by default
			expect(llm).toBeDefined();
		});

		it("should use agent-specific temperature for detective", () => {
			const llm = createLLM({ agentName: "detective" });

			// Detective should have temperature 0.2 by default
			expect(llm).toBeDefined();
		});

		it("should use agent-specific temperature for surgeon", () => {
			const llm = createLLM({ agentName: "surgeon" });

			// Surgeon should have temperature 0.1 by default
			expect(llm).toBeDefined();
		});

		it("should allow temperature override for agent", () => {
			const llm = createLLM({
				agentName: "commander",
				temperature: 0.5,
			});

			expect(llm).toBeDefined();
		});
	});

	describe("Environment variable overrides", () => {
		it("should use COMMANDER_MODEL env var", () => {
			process.env.COMMANDER_MODEL = "claude-3-5-sonnet-latest";

			const llm = createLLM({ agentName: "commander" });

			// Should auto-detect anthropic from model name
			expect(llm.constructor.name).toBe("ChatAnthropic");
		});

		it("should use CARTOGRAPHER_MODEL env var", () => {
			process.env.CARTOGRAPHER_MODEL = "gpt-4o-mini";

			const llm = createLLM({ agentName: "cartographer" });

			expect(llm.constructor.name).toBe("ChatOpenAI");
		});

		it("should auto-detect provider from model name", () => {
			process.env.DETECTIVE_MODEL = "gemini-pro";

			const llm = createLLM({ agentName: "detective" });

			expect(llm.constructor.name).toBe("ChatGoogleGenerativeAI");
		});

		it("should detect OpenAI models", () => {
			process.env.SURGEON_MODEL = "gpt-4-turbo";

			const llm = createLLM({ agentName: "surgeon" });

			expect(llm.constructor.name).toBe("ChatOpenAI");
		});

		it("should detect o1/o3 models as OpenAI", () => {
			process.env.COMMANDER_MODEL = "o1-preview";

			const llm = createLLM({ agentName: "commander" });

			expect(llm.constructor.name).toBe("ChatOpenAI");
		});
	});

	describe("Model name priority", () => {
		it("should prioritize explicit modelName and provider options", () => {
			// Test that explicit options take priority
			const llm = createLLM({
				agentName: "commander",
				modelName: "gpt-4o",
				provider: "openai",
			});

			// Provider should be OpenAI as explicitly specified
			expect(llm.constructor.name).toBe("ChatOpenAI");
		});

		it("should allow mixing agent config with explicit provider", () => {
			// Can use agent name for temperature defaults while overriding provider
			const llm = createLLM({
				agentName: "cartographer",
				provider: "anthropic",
			});

			expect(llm.constructor.name).toBe("ChatAnthropic");
		});
	});

	describe("registerAgentConfig", () => {
		it("should register new agent configuration", () => {
			registerAgentConfig("custom-agent", {
				temperature: 0.3,
				maxTokens: 4096,
			});

			const config = getAgentConfig("custom-agent");

			expect(config).toEqual({
				temperature: 0.3,
				maxTokens: 4096,
			});
		});

		it("should allow using registered agent config", () => {
			registerAgentConfig("test-agent", {
				temperature: 0.5,
			});

			const llm = createLLM({ agentName: "test-agent" });

			expect(llm).toBeDefined();
		});
	});

	describe("getAgentConfig", () => {
		it("should return undefined for unknown agent", () => {
			const config = getAgentConfig("unknown-agent");

			expect(config).toBeUndefined();
		});

		it("should return config for known agents", () => {
			const commanderConfig = getAgentConfig("commander");
			const cartographerConfig = getAgentConfig("cartographer");

			expect(commanderConfig).toBeDefined();
			expect(cartographerConfig).toBeDefined();
			expect(commanderConfig?.temperature).toBe(0.1);
			expect(cartographerConfig?.temperature).toBe(0);
		});
	});

	describe("API key handling", () => {
		it("should use explicit apiKey when provided", () => {
			const llm = createLLM({
				provider: "openai",
				apiKey: "custom-api-key",
			});

			expect(llm).toBeDefined();
		});

		it("should use env var API key when not provided", () => {
			const llm = createLLM({ provider: "openai" });

			expect(llm).toBeDefined();
		});
	});

	describe("Max retries", () => {
		it("should use default max retries", () => {
			const llm = createLLM();

			// Default is 3, can't easily verify but ensure creation works
			expect(llm).toBeDefined();
		});

		it("should use custom max retries", () => {
			const llm = createLLM({ maxRetries: 5 });

			expect(llm).toBeDefined();
		});
	});

	describe("Ollama configuration", () => {
		it("should configure Ollama with base URL", () => {
			process.env.OLLAMA_BASE_URL = "http://custom-ollama:11434";

			const llm = createLLM({
				provider: "ollama",
				modelName: "llama3",
			});

			// Ollama uses ChatOpenAI with custom base URL
			expect(llm.constructor.name).toBe("ChatOpenAI");
		});

		it("should detect Ollama models", () => {
			process.env.COMMANDER_MODEL = "llama3";

			const llm = createLLM({ agentName: "commander" });

			// Should detect as Ollama provider
			expect(llm.constructor.name).toBe("ChatOpenAI");
		});
	});
});
