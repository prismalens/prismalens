import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Include unit and integration tests
		include: ["__tests__/unit/**/*.test.ts", "__tests__/integration/**/*.test.ts"],

		// Exclude E2E tests (run separately with vitest.e2e.config.ts)
		exclude: ["__tests__/e2e/**/*", "__tests__/langsmith/**/*", "**/node_modules/**"],

		// Environment
		environment: "node",

		// Global setup file
		setupFiles: ["./__tests__/setup/vitest.setup.ts"],

		// Test isolation
		isolate: true,

		// Test globals (describe, it, expect)
		globals: true,

		// Type checking
		typecheck: {
			enabled: false, // Disable as we have separate typecheck script
		},

		// Coverage configuration
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.d.ts",
				"src/**/index.ts",
				"src/**/__tests__/**",
				"src/**/types/**",
			],
		},

		// Timeouts
		testTimeout: 30000, // 30s for individual tests
		hookTimeout: 10000, // 10s for setup/teardown hooks

		// Reporters
		reporters: ["verbose"],

		// Pool configuration for parallelism
		pool: "threads",
		poolOptions: {
			threads: {
				singleThread: false,
				isolate: true,
			},
		},

		// Retry failed tests once
		retry: 1,

		// Sequence configuration
		sequence: {
			shuffle: false, // Don't shuffle for predictable ordering
		},
	},

	// Resolve configuration
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
});
