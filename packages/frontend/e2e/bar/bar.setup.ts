// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { readSim } from "./bar";

const SIM_DIR = resolve(process.env.BAR_SIM_DIR ?? "../../.sim-checks");
const OUT = resolve(process.env.BAR_OUT ?? "test-results/bar");

/** Pairs as the host's browser does: an operator link minted on the sim's workspace. */
setup("pair the bar checks' browser with the sim", async ({ browser }) => {
	setup.setTimeout(120_000);
	const sim = readSim(SIM_DIR);
	const state = JSON.parse(readFileSync(join(SIM_DIR, "state.json"), "utf8"));
	const context = await browser.newContext({ baseURL: sim.url });
	const page = await context.newPage();
	const out = execSync(
		"pnpm --silent --filter prismalens dev pair --operator",
		{
			encoding: "utf8",
			cwd: resolve(import.meta.dirname, "../../../.."),
			env: { ...process.env, PRISMALENS_WORKSPACE_DIR: state.workspace },
		},
	);
	const token = out.match(/\/pair#([^\s#]+)/)?.[1];
	expect(token, `no pairing link in:\n${out}`).toBeTruthy();
	await page.goto(`/pair#${token}`);
	await page.waitForURL(/\/(new|incidents|threads)/);
	mkdirSync(OUT, { recursive: true });
	await context.storageState({ path: join(OUT, "paired-state.json") });
	await context.close();
});
