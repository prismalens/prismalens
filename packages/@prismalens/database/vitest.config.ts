// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

/**
 * Coverage gate (repo policy since #58): NEW code ships test-first with ≥80%
 * per-metric coverage, enforced here per-glob. Vitest has no "diff coverage",
 * so the mechanism is additive: when you add a module, add it (or its dir) to
 * `thresholds` below — reviewers treat a new source file with no threshold
 * entry as a missing test. Pre-#58 files are exempt until touched.
 */
const NEW_CODE_THRESHOLD = {
	statements: 80,
	branches: 80,
	functions: 80,
	lines: 80,
};

export default defineConfig({
	test: {
		exclude: ["**/node_modules/**", "**/dist/**"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts"],
			reporter: ["text-summary", "text"],
			thresholds: {
				// perFile so one well-covered module cannot mask a thin one.
				perFile: true,
				"src/migrator/**/*.ts": NEW_CODE_THRESHOLD,
			},
		},
	},
});
