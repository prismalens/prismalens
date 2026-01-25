import { defineConfig } from "vitest/config";

/**
 * E2E Evaluation Config
 *
 * Uses langsmith/vitest for automatic dataset creation and experiment tracking.
 * Run with: pnpm eval
 */
export default defineConfig({
	test: {
		// Evaluation files
		include: ["evals/**/*.eval.ts"],

		// Setup files: env loading + test database
		setupFiles: ["./evals/setup/vitest.setup.ts"],

		// LangSmith reporter + verbose output
		reporters: ["verbose", "langsmith/vitest/reporter"],

		// Environment
		environment: "node",

		// Longer timeouts for LLM operations
		testTimeout: 300000, // 5 min per test (LLM calls can be slow)
		hookTimeout: 60000, // 1 min for setup/teardown (DB seeding)

		// Sequential execution (avoid rate limits)
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},

		// Global test utilities
		globals: true,

		// No retry for evaluations
		retry: 0,

		// Don't shuffle tests
		sequence: {
			shuffle: false,
		},
	},

	// Resolve configuration
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
});
