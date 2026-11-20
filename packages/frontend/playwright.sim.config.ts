// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// bar.setup.ts defaults to .sim-checks; set the default here so pairing and tests read one sim.
process.env.BAR_SIM_DIR ??= resolve("../../.sim");
const sheet = join(resolve(process.env.BAR_SIM_DIR), "sheet.json");
const baseURL = existsSync(sheet)
	? (JSON.parse(readFileSync(sheet, "utf8")) as { url: string }).url
	: undefined;

/**
 * A PR's proof specs (#1176): no web server of its own, they run against the sim in BAR_SIM_DIR
 * that `pnpm sim up` brought up. e2e/bar/bar.setup.ts pairs the browser once; one worker,
 * since the specs share that sim and walk one fixture in order.
 */
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 240_000,
	expect: { timeout: 20_000 },
	reporter: [["list"]],
	projects: [
		{ name: "pair", testMatch: /bar\/bar\.setup\.ts/ },
		{
			name: "sim",
			testMatch: /sim\/.*\.spec\.ts/,
			dependencies: ["pair"],
			use: {
				channel: "msedge",
				baseURL,
				storageState: resolve(
					process.env.BAR_OUT ?? "test-results/bar",
					"paired-state.json",
				),
				viewport: { width: 1440, height: 900 },
			},
		},
	],
});
