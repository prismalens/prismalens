// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

/**
 * Two harnesses, deliberately.
 *
 * DEFAULT — the dev stack: the API on 3001 and Vite on 3000, two servers, two
 * origins bridged by Vite's proxy. It is the loop developers work in.
 *
 * `PL_UP_E2E=1` — the shipped artifact: ONE process on ONE port, installed from
 * the packed tarball (issue #237). This exists because a green run against the
 * dev stack says NOTHING about `pl up`: the dev stack never exercises
 * single-origin serving, the SPA fallback, the copied first-party closure, or
 * boot-time migrations. Everything that made the first packaging attempt fail
 * lives in the gap between the two.
 *
 *   pnpm --filter @prismalens/frontend exec playwright test   # dev stack
 *   PL_UP_E2E=1 pnpm --filter @prismalens/frontend exec playwright test
 */
const PL_UP = process.env.PL_UP_E2E === "1";
const PL_UP_PORT = process.env.PL_UP_PORT ?? "3100";

const workspaceDir = mkdtempSync(join(tmpdir(), "prismalens-e2e-"));
const env = {
	...process.env,
	PRISMALENS_WORKSPACE_DIR: workspaceDir,
	PRISMALENS_SEED_DEMO: "1",
};

if (!PL_UP) {
	// The dev stack needs a migrated, seeded database up front. `pl up` does its
	// own migrations at boot and starts genuinely empty — that IS the first-run
	// journey, so seeding it would destroy the thing under test.
	execSync("pnpm db:init", { cwd: repoRoot, env, stdio: "inherit" });
}

const baseURL = PL_UP
	? `http://localhost:${PL_UP_PORT}`
	: "http://localhost:3000";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: !PL_UP,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// One worker against `pl up`: it is a single process with one SQLite file,
	// and the first-run journey mutates global setup state.
	workers: PL_UP || process.env.CI ? 1 : undefined,
	reporter: "html",
	use: { baseURL },
	webServer: PL_UP
		? [
				{
					command: `node ${join(repoRoot, "scripts/pl-up-e2e.mjs")}`,
					url: `http://localhost:${PL_UP_PORT}/health`,
					env: { ...process.env, PL_UP_PORT },
					reuseExistingServer: false,
					// Packing + a cold npm install of the tarball.
					timeout: 300_000,
					stdout: "pipe",
				},
			]
		: [
				{
					command: "pnpm --filter @prismalens/api start",
					url: "http://localhost:3001/health",
					env,
					reuseExistingServer: false,
					timeout: 60_000,
				},
				{
					command: "pnpm --filter @prismalens/frontend dev",
					url: "http://localhost:3000",
					env,
					reuseExistingServer: false,
					timeout: 60_000,
				},
			],
	projects: PL_UP
		? [
				{
					// The artifact starts with no owner account, so the journey that
					// covers it IS the setup flow — no storageState, no setup project.
					name: "pl-up",
					testDir: "./e2e/pl-up",
					use: { ...devices["Desktop Chrome"] },
				},
			]
		: [
				{ name: "setup", testMatch: /auth\.setup\.ts/ },
				{
					// Note: Firefox and WebKit projects are a deliberate follow-up for broader browser coverage.
					name: "chromium",
					testIgnore: /pl-up\//,
					use: {
						...devices["Desktop Chrome"],
						storageState: "e2e/.auth/owner.json",
					},
					dependencies: ["setup"],
				},
			],
});
