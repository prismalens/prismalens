// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "vitest/config";

/**
 * Coverage floors (docs/contributing/testing.md, #1206): a ratchet, never a target.
 * A per-file entry below guards a module that already has its tests; a new module needs none.
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
		// demo-data.test.ts's beforeAll shells out to a cold-start `prisma migrate
		// deploy`; measured 28.7-33.5s under artificial 8x CPU oversubscription
		// (#550) blew the old 30s ceiling from #542 - 120s keeps 3.5x+ headroom.
		hookTimeout: 120000,
		// Same test's body does real seed writes + read-back assertions; raced the
		// 5s default too (#548) - measured 5.4-5.8s under the same 8x oversubscription
		// (vs. ~0.5s idle), so 20s keeps 3.4x+ headroom.
		testTimeout: 20000,
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
