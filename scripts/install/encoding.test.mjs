// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Windows PowerShell 5.1 reads a BOM-less script as ANSI under -File, and a BOM would land
// in the script body under `irm | iex`, so the .ps1 files stay ASCII (#906).

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const scripts = (ext) =>
	readdirSync(DIR)
		.filter((f) => f.endsWith(ext))
		.map((f) => [f, readFileSync(join(DIR, f))]);

test("every .ps1 installer script is pure ASCII", () => {
	const files = scripts(".ps1");
	assert.ok(files.length > 0);
	for (const [name, bytes] of files) {
		const at = bytes.findIndex((b) => b > 0x7f);
		if (at === -1) continue;
		const line = bytes.subarray(0, at).toString("latin1").split("\n").length;
		assert.fail(
			`${name}:${line} has a non-ASCII byte 0x${bytes[at].toString(16)}`,
		);
	}
});

test("no .sh installer script starts with a UTF-8 BOM", () => {
	for (const [name, bytes] of scripts(".sh")) {
		assert.ok(
			!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
			`${name} starts with a BOM`,
		);
	}
});
