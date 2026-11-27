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

const offending = (source, pattern) =>
	source
		.split("\n")
		.map((line, i) => ({ line: i + 1, text: line.trim() }))
		.filter(({ text }) => !text.startsWith("#") && pattern.test(text));

test("install.sh deletes folders only through discard", () => {
	const rest = withoutHelper(read("./install.sh"), "discard() {\n");
	assert.deepEqual(offending(rest, /\brm\s+-[a-zA-Z]*[rR]/), []);
});

test("install.ps1 deletes folders only through Remove-Owned", () => {
	const rest = withoutHelper(
		read("./install.ps1"),
		"function Remove-Owned([string]$Path) {\n",
	);
	assert.deepEqual(offending(rest, /Remove-Item\b.*-Recurse/i), []);
});
