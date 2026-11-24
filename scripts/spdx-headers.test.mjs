// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Every first-party source file opens with the SPDX licence header. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

const root = dirname(import.meta.dirname);
// Third-party sample payloads, a generated route tree, a fixture repo and a vendored parser.
const NOT_OURS =
	/__fixtures__\/|routeTree\.gen\.ts$|^scripts\/fakes\/real-agent-repo\/|^scripts\/launcher\/ini\.cjs$/;

export function missingHeader(files, read) {
	return files.filter(
		(f) =>
			/^(packages|scripts)\/.*\.(ts|tsx|mts|mjs|cjs|js)$/.test(f) &&
			!NOT_OURS.test(f) &&
			!read(f).slice(0, 300).includes("SPDX-License-Identifier: Apache-2.0"),
	);
}

test("a source file without the header is named", () => {
	const files = { "packages/api/src/a.ts": "export const a = 1;\n" };
	assert.deepEqual(
		missingHeader(Object.keys(files), (f) => files[f]),
		["packages/api/src/a.ts"],
	);
});

test("every first-party source file in the repo carries the header", () => {
	const files = execFileSync("git", ["ls-files"], {
		cwd: root,
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean);
	assert.deepEqual(
		missingHeader(files, (f) => readFileSync(join(root, f), "utf8")),
		[],
	);
});
