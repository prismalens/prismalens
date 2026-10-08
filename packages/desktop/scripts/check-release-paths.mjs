#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Fail the desktop build when the unpacked app would not survive a Windows
 * "Extract All": more files than the budget, or (with --paths) an entry that
 * passes MAX_PATH once extracted under a 100-character folder such as
 * C:\Users\<name>\Downloads\<zip name>\ (#673 w53: 23,144 files, 12 paths past
 * 260, a missing migration.sql).
 *
 *   node scripts/check-release-paths.mjs [--paths] [--prefix 100] [--max-files 1000]
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MAX_PATH = 259; // 260 with the terminating NUL

const { values } = parseArgs({
	options: {
		paths: { type: "boolean", default: false },
		prefix: { type: "string", default: "100" },
		"max-files": { type: "string", default: "1000" },
	},
});
const prefix = Number(values.prefix);
const maxFiles = Number(values["max-files"]);

const release = resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"../release",
);
const dir = readdirSync(release).find(
	(d) => !d.startsWith(".") && statSync(join(release, d)).isDirectory(),
);
if (!dir) throw new Error(`no unpacked app under ${release}`);

const files = [];
const walk = (d) => {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name);
		if (e.isDirectory()) walk(p);
		else files.push(relative(release, p).split(sep).join("\\"));
	}
};
walk(join(release, dir));

const longest = files.reduce((a, b) => (b.length > a.length ? b : a), "");
console.log(
	`${dir}: ${files.length} files (budget ${maxFiles}); longest entry ${longest.length} chars: ${longest}`,
);
const problems = [];
if (files.length > maxFiles)
	problems.push(`${files.length} files is over the budget of ${maxFiles}`);
if (values.paths) {
	const over = files.filter((f) => prefix + 1 + f.length > MAX_PATH);
	for (const f of over)
		problems.push(
			`${prefix + 1 + f.length} chars once extracted under a ${prefix}-char folder: ${f}`,
		);
}
if (problems.length) {
	for (const p of problems) console.error(`::error::${p}`);
	process.exit(1);
}
console.log("ok");
