import { defineConfig } from "vitest/config";

/**
 * E2E Test Configuration with LangSmith Integration
 *
 * This config is used for:
 * - Full workflow tests
 * - LangSmith-tracked evaluation experiments
 * - Scenario-based testing
 *
 * Run with: pnpm test:e2e
 */
export default defineConfig({
	test: {
		// Include only E2E and LangSmith tests
		include: ["__tests__/e2e/**/*.test.ts", "__tests__/langsmith/**/*.test.ts"],

		// Environment
		environment: "node",

		// Setup file (includes LangSmith initialization)
		setupFiles: [
			"./__tests__/setup/vitest.setup.ts",
			"./__tests__/setup/langsmith.setup.ts",
		],

		// Test isolation
		isolate: true,

		// Global test utilities
		globals: true,

		// Longer timeouts for E2E tests (agent workflows can take time)
		testTimeout: 120000, // 2 minutes
		hookTimeout: 30000, // 30s for setup/teardown

		// Sequential execution for E2E (to avoid rate limits and state conflicts)
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true, // Run tests sequentially
			},
		},

		// Reporters
		reporters: ["verbose"],

		// No retry for E2E tests (flakiness should be investigated)
		retry: 0,

		// Sequence configuration
		sequence: {
			shuffle: false,
		},

		// Environment variables for LangSmith
		env: {
			LANGSMITH_TRACING: "true",
			LANGCHAIN_TRACING_V2: "true",
		},
	},

	// Resolve configuration
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
});
