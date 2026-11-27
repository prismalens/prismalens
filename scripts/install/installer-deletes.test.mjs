#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Each installer deletes folders through one helper, which keeps any app this install didn't put
// there: discard in install.sh, Remove-Owned in install.ps1. A recursive delete anywhere else fails.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) =>
	readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The script without the helper's own body: from its first line to the closing brace at column 0.
function withoutHelper(source, opening) {
	const start = source.indexOf(opening);
	assert.notEqual(start, -1, `the helper "${opening}" is missing`);
	const end = source.indexOf("\n}\n", start);
	assert.notEqual(end, -1, `the helper "${opening}" has no closing brace`);
	return source.slice(0, start) + source.slice(end + 3);
}

// Commands as written, one per entry: a line ending in a continuation joins the next.
const commands = (source, continuation) =>
	source
		.replace(new RegExp(`\\${continuation}\\n\\s*`, "g"), " ")
		.split("\n")
		.map((text) => text.trim())
		.filter((text) => text && !text.startsWith("#"));

// rm with -r or -R in any of its option groups, or --recursive.
const recursiveRm = (command) =>
	[...command.matchAll(/(?:^|[\s;&|({!])rm((?:\s+-[-\w]+)+)/g)].some(
		([, options]) =>
			options
				.trim()
				.split(/\s+/)
				.some(
					(o) => o === "--recursive" || (/^-[^-]/.test(o) && /[rR]/.test(o)),
				),
	);

// Remove-Item with -Recurse, or any prefix of it PowerShell accepts (-r, -rec, ...).
const recursiveRemoveItem = (command) =>
	/\bRemove-Item\b/i.test(command) &&
	/\s-r(e(c(u(r(s(e)?)?)?)?)?)?\b/i.test(command);

const shOffending = (source) => commands(source, "\\").filter(recursiveRm);
const psOffending = (source) =>
	commands(source, "`").filter(recursiveRemoveItem);

test("the guard sees rm -r in any option group, and a continued Remove-Item -Recurse", () => {
	assert.deepEqual(
		shOffending(
			'rm -f -r "$dir"\nrm -rf "$a"\nrm --recursive x\nrm -f "$file"\n',
		),
		['rm -f -r "$dir"', 'rm -rf "$a"', "rm --recursive x"],
	);
	assert.deepEqual(shOffending('x || rm -fR "$d"\n'), ['x || rm -fR "$d"']);
	assert.deepEqual(
		psOffending("Remove-Item $x `\n\t-Recurse -Force\nRemove-Item $f -Force\n"),
		["Remove-Item $x  -Recurse -Force"],
	);
	assert.deepEqual(psOffending("Remove-Item $x -Rec\n"), [
		"Remove-Item $x -Rec",
	]);
});

test("install.sh deletes folders only through discard", () => {
	const rest = withoutHelper(read("./install.sh"), "discard() {\n");
	assert.deepEqual(shOffending(rest), []);
});

test("install.ps1 deletes folders only through Remove-Owned", () => {
	const rest = withoutHelper(
		read("./install.ps1"),
		"function Remove-Owned([string]$Path) {\n",
	);
	assert.deepEqual(psOffending(rest), []);
});
