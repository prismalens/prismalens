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
 *   node scripts/check-release-paths.mjs [--paths] [--prefix 100] [--max-files 1000] [--max-mb <n>]
 *
 * --max-mb holds the unpacked app to the scripts/artifact-budgets.json size (#906).
 */

import { lstatSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MAX_PATH = 259; // 260 with the terminating NUL

const { values } = parseArgs({
	options: {
		paths: { type: "boolean", default: false },
		prefix: { type: "string", default: "100" },
		"max-files": { type: "string", default: "1000" },
		"max-mb": { type: "string" },
	},
});
const prefix = Number(values.prefix);
const maxFiles = Number(values["max-files"]);
const maxMb =
	values["max-mb"] === undefined ? undefined : Number(values["max-mb"]);

const release = resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"../release",
);
const dir = readdirSync(release).find(
	(d) => !d.startsWith(".") && statSync(join(release, d)).isDirectory(),
);
if (!dir) throw new Error(`no unpacked app under ${release}`);

const files = [];
let bytes = 0;
const walk = (d) => {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name);
		if (e.isDirectory()) walk(p);
		else {
			files.push(relative(release, p).split(sep).join("\\"));
			bytes += lstatSync(p).size;
		}
	}
};
walk(join(release, dir));

const longest = files.reduce((a, b) => (b.length > a.length ? b : a), "");
console.log(
	`${dir}: ${files.length} files (budget ${maxFiles}), ${(bytes / 1e6).toFixed(1)} MB (budget ${maxMb ?? "none"}); longest entry ${longest.length} chars: ${longest}`,
);
const problems = [];
if (maxMb !== undefined && bytes > maxMb * 1e6)
	problems.push(
		`${(bytes / 1e6).toFixed(1)} MB unpacked is over the budget of ${maxMb} MB`,
	);
if (files.length > maxFiles)
	problems.push(`${files.length} files is over the budget of ${maxFiles}`);
// Only this platform's native prebuilds ship (#673 walk 4).
const own = [`${process.platform}-${process.arch}`];
if (process.platform === "linux") own.push(`linuxmusl-${process.arch}`);
for (const f of files) {
	const parts = f.split("\\");
	const at = parts.indexOf("prebuilds");
	const name = at >= 0 ? parts[at + 1] : undefined;
	if (name && !own.some((t) => name === t || name.startsWith(`${t}.`)))
		problems.push(`a prebuild for another platform ships: ${f}`);
}
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
