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
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
execFileSync(
	"npm",
	[
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
console.log(`staged ${out}/lib/node_modules/prismalens`);
