// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig, devices } from "@playwright/test";

/**
 * The bar checks (#1101 Scores): no web server of its own, it runs against the sim in
 * BAR_SIM_DIR that `pnpm sim judge-evidence` (or the caller) brought up with --profile all.
 * e2e/bar/bar.setup.ts pairs the browser once; one worker, since checks share that sim.
 */
export default defineConfig({
	testDir: "./e2e/bar",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	expect: { timeout: 20_000 },
	reporter: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME
		? [["list"], ["json"]]
		: [["list"]],
	projects: [
		{ name: "pair", testMatch: /bar\.setup\.ts/ },
		{
			name: "bar",
			testMatch: /bar-checks\.spec\.ts/,
			dependencies: ["pair"],
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
