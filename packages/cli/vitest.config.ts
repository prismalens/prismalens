// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

/**
 * Coverage gate (repo policy since #58): NEW code ships test-first with ≥80%
 * per-metric coverage, enforced here per-glob. Vitest has no "diff coverage",
 * so the mechanism is additive: when you add a module, add its glob to
 * `thresholds` below with `{ statements: 80, branches: 80, functions: 80,
 * lines: 80 }` — reviewers treat a new source file with no threshold entry as
 * a missing test. Pre-#58 files are exempt until touched.
 */
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts"],
			reporter: ["text-summary", "lcov", "text"],
			thresholds: {},
		},
	},
});
