// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { installFakeAgent } from "../../scripts/fakes/fake-acp-agent.mjs";
import { agentFreePath, type Stack, stackFor, workerCount } from "./e2e/stacks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

/**
 * Two harnesses, deliberately.
 *
 * DEFAULT — the dev stack: an API and a Vite per worker (3001 and 3000 for the
 * first, then +2 each), bridged by Vite's proxy. It is the loop developers work in.
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
 *
 * The dev-stack ports are overridable. `reuseExistingServer: false` on
 * hard-coded ports means an e2e run takes down whatever already holds 3000 or
 * 3001 — a real hazard with several worktrees on one machine. Defaults are
 * unchanged, so CI and the documented command above are unaffected:
 *
 *   PRISMALENS_FRONTEND_PORT=3200 PRISMALENS_PORT=3201 \
 *     pnpm --filter @prismalens/frontend exec playwright test
 */
const PL_UP = process.env.PL_UP_E2E === "1";
const PL_UP_PORT = process.env.PL_UP_PORT ?? "3100";
// `pl-up-e2e.mjs` installs into this prefix and runs its workspace under it;
// the pl-up spec reads the same variable to pair with `pl pair --operator`.
if (PL_UP) {
	process.env.PL_UP_PREFIX ??= mkdtempSync(join(tmpdir(), "pl-up-e2e-"));
}

// Validated, not coerced: a junk value would otherwise reach Vite as NaN, which
// makes it bind a random port and every later failure point at the wrong thing.
function resolvePort(name: string, fallback: string): string {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`${name} must be an integer between 1 and 65535, got "${raw}"`,
		);
	}
	return String(port);
}

const FRONTEND_PORT = resolvePort("PRISMALENS_FRONTEND_PORT", "3000");
const API_PORT = resolvePort("PRISMALENS_PORT", "3001");

// One isolated stack (API, Vite, workspace, fake agents) per worker: the suite's
// journeys mutate global state, so workers sharing one server raced each other.
// Workers re-evaluate this file with TEST_PARALLEL_INDEX set and pick their own.
const WORKERS = PL_UP ? 1 : workerCount(process.argv, !!process.env.CI);
process.env.PRISMALENS_E2E_WORKERS = String(WORKERS);
const isRunner = process.env.TEST_PARALLEL_INDEX === undefined;
process.env.PRISMALENS_E2E_ROOT ??= mkdtempSync(
	join(tmpdir(), "prismalens-e2e-"),
);
const e2eRoot = process.env.PRISMALENS_E2E_ROOT;
const stacks = Array.from({ length: WORKERS }, (_, i) =>
	stackFor(e2eRoot, i, Number(FRONTEND_PORT), Number(API_PORT)),
);
const ownStack =
	stacks[Number(process.env.TEST_PARALLEL_INDEX ?? 0)] ?? stacks[0];
process.env.PRISMALENS_E2E_STACKS = JSON.stringify(stacks);
process.env.PRISMALENS_E2E_WORKSPACE_DIR = ownStack.workspaceDir;

// Agents installed on a developer's machine would answer the harness gate, so the
// servers and tests get no PATH but the tools and the fakes; see e2e/README.md.
// Computed once by the runner: in a worker, PATH already leads to the wrappers.
process.env.PRISMALENS_E2E_TOOLS_PATH ??=
	PL_UP || process.env.PRISMALENS_E2E_KEEP_PATH === "1"
		? (process.env.PATH ?? "")
		: agentFreePath(join(e2eRoot, "tools-bin"));
const toolsPath = process.env.PRISMALENS_E2E_TOOLS_PATH;

function stackEnv(stack: Stack): Record<string, string> {
	// The fake ACP agent on PATH as `opencode` and `claude-agent-acp`: the server's
	// harness gate passes and a run replays scripts/fakes/sessions/success.json
	// (or the session a `fake-session:<name>` in the alert picks).
	const harnessBinDir = join(stack.workspaceDir, "harness-bin");
	const inherited = Object.entries(process.env).filter(
		(e): e is [string, string] => e[1] !== undefined,
	);
	return {
		...Object.fromEntries(inherited),
		PATH: `${harnessBinDir}${delimiter}${toolsPath}`,
		PRISMALENS_WORKSPACE_DIR: stack.workspaceDir,
		PRISMALENS_SEED_DEMO: "1",
		// Both servers read these: the API binds PRISMALENS_PORT, and Vite both
		// binds PRISMALENS_FRONTEND_PORT and proxies /api to PRISMALENS_PORT.
		PRISMALENS_PORT: stack.apiPort,
		PRISMALENS_FRONTEND_PORT: stack.frontendPort,
		// Better Auth rejects a sign-in from an origin it does not trust, and the
		// browser's origin here is Vite's. Moving the port without this yields
		// "Invalid origin" on every login.
		PRISMALENS_FRONTEND_URL: stack.frontendURL,
		PRISMALENS_CORS_ORIGIN: stack.frontendURL,
		// Separate optimizer caches: concurrent Vites rewriting one would race.
		PRISMALENS_VITE_CACHE_DIR: join(
			__dirname,
			"node_modules",
			`.vite-e2e-${stack.index}`,
		),
	};
}

// The test process runs the fakes the scenario installs, and `pnpm` for pairing.
if (!PL_UP) process.env.PATH = stackEnv(ownStack).PATH;

// `bddgen` loads this file only to read the BDD config: no stacks to prepare.
if (!PL_UP && isRunner && !process.env.PLAYWRIGHT_BDD_GEN) {
	// The dev stack needs a migrated, seeded database up front. `pl up` does its
	// own migrations at boot and starts genuinely empty — that IS the first-run
	// journey, so seeding it would destroy the thing under test.
	for (const stack of stacks) {
		mkdirSync(join(stack.workspaceDir, "harness-bin"), { recursive: true });
		installFakeAgent(join(stack.workspaceDir, "harness-bin"), {
			session: "success",
			stateDir: join(stack.workspaceDir, "fake-agent-state"),
		});
		execSync("pnpm db:init", {
			cwd: repoRoot,
			env: stackEnv(stack),
			stdio: "inherit",
		});
	}
	// Built once and run from dist: `nest start` per stack would rebuild one outDir concurrently.
	execSync("pnpm --filter @prismalens/api build", {
		cwd: repoRoot,
		stdio: "inherit",
	});
}

const PAIRED_STATE = join(ownStack.workspaceDir, "paired-state.json");

// Gherkin journeys: `bddgen` compiles e2e/features into specs these projects run.
const journeysDir = defineBddConfig({
	features: "e2e/features/*.feature",
	steps: "e2e/steps/*.ts",
	outputDir: "e2e/.features-gen",
});

const baseURL = PL_UP ? `http://localhost:${PL_UP_PORT}` : ownStack.frontendURL;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: !PL_UP,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// One worker against `pl up`: it is a single process with one SQLite file,
	// and the first-run journey mutates global setup state. The dev stack runs
	// one stack per worker, so it parallelises.
	workers: WORKERS,
	reporter: "html",
	use: { baseURL },
	webServer: PL_UP
		? [
				{
					command: `node "${join(repoRoot, "scripts/pl-up-e2e.mjs")}"`,
					url: `http://localhost:${PL_UP_PORT}/health`,
					env: { ...process.env, PL_UP_PORT },
					reuseExistingServer: false,
					// Packing + a cold npm install of the tarball.
					timeout: 300_000,
					stdout: "pipe",
				},
			]
		: [
				...stacks.flatMap((stack) => [
					{
						// Ready on the server's own line, not a URL probe: a probe of a port
						// nothing listens on yet hangs for minutes under WSL2 mirrored networking.
						command: "node dist/src/main.js",
						cwd: join(repoRoot, "packages/api"),
						wait: { stdout: /API running on/ },
						env: { ...stackEnv(stack), PRISMALENS_LOG_CONSOLE: "verbose" },
						reuseExistingServer: false,
						timeout: 60_000,
					},
					{
						// Strict: a taken port must fail the run, not move Vite onto another stack's.
						command: "pnpm --filter @prismalens/frontend dev --strictPort",
						wait: { stdout: /Local:/ },
						env: stackEnv(stack),
						reuseExistingServer: false,
						timeout: 60_000,
					},
				]),
			],
	projects: PL_UP
		? [
				{
					name: "pl-up",
					testDir: "./e2e/pl-up",
					use: { ...devices["Desktop Chrome"] },
				},
			]
		: [
				{
					// The browser pairs the way the host's own does (ADR 0004 §8):
					// one operator link per stack, redeemed once, its cookie shared by
					// that stack's worker.
					name: "pair",
					testMatch: /pair\.setup\.ts/,
					use: { ...devices["Desktop Chrome"] },
				},
				{
					// Note: Firefox and WebKit projects are a deliberate follow-up for broader browser coverage.
					name: "chromium",
					// vitest's own e2e/*.test.ts (stacks.test.ts): Playwright's default
					// testMatch picks up *.test.ts too, so it must be told to skip them.
					testIgnore: [/pl-up\//, /\.features-gen\//, /\.test\.ts$/],
					dependencies: ["pair"],
					use: { ...devices["Desktop Chrome"], storageState: PAIRED_STATE },
				},
				{
					name: "journeys",
					testDir: journeysDir,
					dependencies: ["pair"],
					use: { ...devices["Desktop Chrome"], storageState: PAIRED_STATE },
				},
				// Nightly (e2e-responsive.yml), @responsive features only. Chromium for the
				// iPad too: these check layout at its size, and CI installs one browser.
				...(["Pixel 7", "iPad (gen 7)"] as const).map((device) => ({
					name: device,
					testDir: journeysDir,
					grep: /@responsive/,
					dependencies: ["pair"],
					use: {
						...devices[device],
						defaultBrowserType: "chromium" as const,
						storageState: PAIRED_STATE,
					},
				})),
			],
});
