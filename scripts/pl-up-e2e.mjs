#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Boot `pl up` from the PACKED TARBALL for Playwright's `pl-up` project.
 *
 * The default e2e harness starts TWO servers — the API on 3001 and Vite on 3000 —
 * so a green run against it says nothing about whether `pl up` works: it never
 * exercises single-origin serving, the SPA fallback, or the copied first-party
 * closure. This runs the real artifact instead: pack it, install it into a
 * throwaway prefix exactly the way a user's `npm i -g prismalens` would, and
 * exec `pl up` against an empty workspace so the first-run journey is genuinely
 * first-run.
 *
 * Env:
 *   PRISMALENS_TARBALL  use this tarball instead of packing one (CI reuses the
 *                       artifact the packed-smoke gate already verified)
 *   PL_UP_PORT          port to serve on (default 3100)
 *   PL_UP_PREFIX        install prefix (default a fresh mkdtemp)
 */

import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PL_UP_PORT ?? "3100";

function tarball() {
	if (process.env.PRISMALENS_TARBALL) return process.env.PRISMALENS_TARBALL;
	const out = join(ROOT, "packages", "cli", "dist-pack");
	if (!existsSync(out) || !readdirSync(out).some((f) => f.endsWith(".tgz"))) {
		console.log("[pl-up-e2e] no tarball yet — packing");
		execFileSync("node", [join(ROOT, "scripts", "pack-cli.mjs")], {
			cwd: ROOT,
			stdio: "inherit",
		});
	}
	const found = readdirSync(out).find((f) => f.endsWith(".tgz"));
	if (!found) throw new Error(`no tarball produced in ${out}`);
	return join(out, found);
}

const prefix =
	process.env.PL_UP_PREFIX ?? mkdtempSync(join(tmpdir(), "pl-up-e2e-"));
const workspace = join(prefix, "workspace");
mkdirSync(workspace, { recursive: true });

const tgz = tarball();
console.log(`[pl-up-e2e] installing ${tgz} into ${prefix}`);
// A global-style install: the same layout `npm i -g prismalens` produces, so the
// bin wiring and the bundled node_modules are exercised, not bypassed.
execFileSync(
	"npm",
	[
		"install",
		"--prefix",
		prefix,
		"--no-audit",
		"--no-fund",
		"--loglevel=error",
		tgz,
	],
	{ stdio: "inherit" },
);

const bin = join(prefix, "node_modules", ".bin", "pl");
if (!existsSync(bin)) throw new Error(`pl bin not linked at ${bin}`);

console.log(
	`[pl-up-e2e] pl up on http://localhost:${PORT} (workspace ${workspace})`,
);
const child = spawn(bin, ["up"], {
	stdio: "inherit",
	env: {
		...process.env,
		PRISMALENS_WORKSPACE_DIR: workspace,
		PRISMALENS_HOST: "127.0.0.1",
		PRISMALENS_PORT: PORT,
		NODE_ENV: "production",
	},
});

const cleanup = () => {
	child.kill("SIGKILL");
	if (!process.env.PL_UP_PREFIX)
		rmSync(prefix, { recursive: true, force: true });
};
process.on("SIGINT", () => {
	cleanup();
	process.exit(130);
});
process.on("SIGTERM", () => {
	cleanup();
	process.exit(143);
});
child.on("exit", (code) => process.exit(code ?? 1));
