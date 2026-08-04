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

// Isolated workspace directory for e2e test execution
const workspaceDir = mkdtempSync(join(tmpdir(), "prismalens-e2e-"));
const env = {
	...process.env,
	PRISMALENS_WORKSPACE_DIR: workspaceDir,
	PRISMALENS_SEED_DEMO: "1",
};

// Initialize database schema and seed demo data in the isolated workspace
execSync("pnpm db:init", {
	cwd: resolve(__dirname, "../.."),
	env,
	stdio: "inherit",
});

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	use: {
		baseURL: "http://localhost:3000",
	},
	webServer: [
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
	projects: [
		{ name: "setup", testMatch: /auth\.setup\.ts/ },
		{
			// Note: Firefox and WebKit projects are a deliberate follow-up for broader browser coverage.
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				storageState: "e2e/.auth/owner.json",
			},
			dependencies: ["setup"],
		},
	],
});
