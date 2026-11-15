// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		coverage: {
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/cli.ts"],
			thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
		},
	},
});
