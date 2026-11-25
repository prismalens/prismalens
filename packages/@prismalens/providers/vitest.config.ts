// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		testTimeout: 60_000,
		coverage: {
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.gen.ts"],
			thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
		},
	},
});
