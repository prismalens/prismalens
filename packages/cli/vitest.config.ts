// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

/**
 * Coverage floors (docs/contributing/testing.md, #1206): a ratchet, never a target.
 * A per-file entry below guards a module that already has its tests; a new module needs none.
 */
/**
 * Package floor = the coverage this package ACTUALLY had when the gate was first
 * wired into CI (#58's policy was written but never run, so the old numbers were
 * aspirational, not real). It is a RATCHET, not a target: raise it as coverage
 * improves, never lower it to make a red build pass.
 */
const PACKAGE_FLOOR = {
	statements: 26,
	branches: 17,
	functions: 48,
	lines: 26,
};

const NEW_CODE = { statements: 80, branches: 80, functions: 80, lines: 80 };

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts"],
			reporter: ["text-summary", "lcov", "text"],
			thresholds: {
				...PACKAGE_FLOOR,
				"src/cli/update-notice.ts": NEW_CODE,
			},
		},
	},
});
