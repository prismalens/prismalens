#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Stage the packed `prismalens` package under resources/prismalens, the way a
 * user's `npm install -g prismalens` lays it out, so the launcher runs exactly
 * the artifact the npm channel ships (the invariant on #83: one server, two
 * distribution channels).
 */

import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
const out = resolve(here, "../resources/prismalens");
const tmp = mkdtempSync(join(tmpdir(), "pl-desktop-"));

execFileSync(
	"node",
	[join(repoRoot, "scripts/pack-cli.mjs"), "--skip-build", "--out", tmp],
	{
		stdio: "inherit",
	},
);
const tarball = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
if (!tarball) throw new Error(`pack-cli.mjs produced no tarball in ${tmp}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// `npm install` into a prefix resolves the tarball's bundled dependencies the
// way a global install does; the result is <out>/lib/node_modules/prismalens.
// On Windows npm is `npm.cmd`, which Node will not spawn without a shell.
const npm =
	process.platform === "win32"
		? { command: "cmd.exe", prefix: ["/d", "/c", "npm"] }
		: { command: "npm", prefix: [] };
execFileSync(
	npm.command,
	[
		...npm.prefix,
		"install",
		"-g",
		"--prefix",
		out,
		"--no-audit",
		"--no-fund",
		join(tmp, tarball),
	],
	{ stdio: "inherit" },
);
rmSync(tmp, { recursive: true, force: true });

// No @electron/rebuild: libsql is a Node-API addon, so the binding npm picked
// for this platform loads under Electron's Node ABI unchanged (#762, n1).
// A global install lays packages out under `lib/node_modules` on POSIX and
// `node_modules` on Windows. electron-builder drops a top-level `node_modules`
// from extraResources, so Windows moves to the POSIX layout the app reads.
if (process.platform === "win32") {
	mkdirSync(join(out, "lib"), { recursive: true });
	renameSync(join(out, "node_modules"), join(out, "lib", "node_modules"));
}
const staged = join(out, "lib", "node_modules", "prismalens");
console.log(`staged ${staged}`);
