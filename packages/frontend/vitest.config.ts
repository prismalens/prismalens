// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsConfigPaths()],
	test: {
		// CI fails a test that spends over VITEST_TIMEOUT_BUDGET of its timeout here (#1085).
		...(process.env.VITEST_TIMEOUT_BUDGET
			? {
					reporters: [
						"default",
						"../../scripts/lib/timeout-budget-reporter.mjs",
					],
				}
			: {}),
		// Unit tests render the registry and markdown in one pass (src/test-setup.ts).
		setupFiles: ["./src/test-setup.ts"],
		include: [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"e2e/*.test.ts",
			"*.test.ts",
		],
	},
});
