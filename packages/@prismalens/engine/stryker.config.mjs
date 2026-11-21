// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Mutation testing, run weekly by .github/workflows/mutation.yml: a survived mutant is a test that cannot fail.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
	testRunner: "vitest",
	plugins: ["@stryker-mutator/vitest-runner"],
	// Run as `pnpm test` does (#1154): vitest's default forks, where process.umask() works, and in place,
	// since specs reach the repo's scripts/fakes by relative path, which a sandbox copy breaks.
	vitest: { pool: "forks" },
	inPlace: true,
	mutate: ["src/run/permission*.ts", "!src/**/*.test.ts"],
	coverageAnalysis: "perTest",
	concurrency: 4,
	timeoutMS: 30_000,
	reporters: ["clear-text", "progress", "html"],
	htmlReporter: { fileName: "reports/mutation/index.html" },
	thresholds: { high: 80, low: 60, break: null },
};
