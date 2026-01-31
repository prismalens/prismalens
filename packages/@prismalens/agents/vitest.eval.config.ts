import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Load .env before reading config values
config();

/**
 * E2E Evaluation Config
 *
 * Uses langsmith/vitest for automatic dataset creation and experiment tracking.
 * Run with: pnpm eval
 *
 * Timeout Configuration:
 * - TEST_TIMEOUT_MS: Test timeout in milliseconds (default: 300000 = 5 min)
 *   For slower LLMs (e.g., large local models), increase this value.
 *   Set in .env file or pass as env var.
 */

const testTimeout = parseInt(process.env.TEST_TIMEOUT_MS || "300000", 10);

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

		// Configurable timeout for LLM operations
		// Override with TEST_TIMEOUT_MS env var for slower models
		testTimeout,
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
