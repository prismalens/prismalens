// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Mutation testing, run weekly by .github/workflows/mutation.yml: a survived mutant is a test that cannot fail.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
	testRunner: "vitest",
	plugins: ["@stryker-mutator/vitest-runner"],
	// Run as `pnpm test` does (#1154): vitest's default forks, and in place, since specs reach
	// the engine's fixtures and the repo's scripts/fakes by relative path, which a sandbox copy breaks.
	vitest: { pool: "forks" },
	inPlace: true,
	// The dry run is one serial worker over ~270 related specs (CI: 225s on 4 forks); the 5-minute default cannot hold it.
	dryRunTimeoutMinutes: 45,
	mutate: [
		"src/middlewares/host-allowlist.middleware.ts",
		"src/core/auth/auth.guard.ts",
		"src/core/auth/owner.ts",
		"src/infrastructure/dispatch/**/*.ts",
		"!src/**/*.spec.ts",
	],
	coverageAnalysis: "perTest",
	concurrency: 4,
	timeoutMS: 30_000,
	// scripts/mutation-report.mjs reads the JSON report (default reports/mutation/mutation.json).
	reporters: ["clear-text", "progress", "html", "json"],
	htmlReporter: { fileName: "reports/mutation/index.html" },
	thresholds: { high: 80, low: 60, break: null },
};
