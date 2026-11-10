// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Every action and reusable workflow runs a fixed commit: release credentials never ride a moving ref. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dir = join(import.meta.dirname, "..", ".github", "workflows");

test("every external uses: is a commit SHA with its version in a comment", () => {
	const loose = [];
	for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
		const lines = readFileSync(join(dir, file), "utf8").split("\n");
		lines.forEach((line, i) => {
			const m = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
			if (!m || m[1].startsWith("./")) return;
			if (!/@[0-9a-f]{40}$/.test(m[1]) || !/#\s*\S/.test(m[2]))
				loose.push(`${file}:${i + 1} ${m[1]}`);
		});
	}
	assert.deepEqual(loose, []);
});

test("no workflow pipes a script fetched from a moving URL", () => {
	for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)))
		assert.doesNotMatch(
			readFileSync(join(dir, file), "utf8"),
			/get\.scoop\.sh/,
			file,
		);
});
