// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Mutation testing, run weekly by .github/workflows/mutation.yml: a survived mutant is a test that cannot fail.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
	testRunner: "vitest",
	plugins: ["@stryker-mutator/vitest-runner"],
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
	reporters: ["clear-text", "progress", "html"],
	htmlReporter: { fileName: "reports/mutation/index.html" },
	thresholds: { high: 80, low: 60, break: null },
};
