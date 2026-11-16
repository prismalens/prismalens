// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { plan, protectedTags } from "./prune-nightlies.mjs";

const nightly = (day, run) =>
	`v0.5.7-nightly.202611${String(day).padStart(2, "0")}.${run}`;
const releases = [
	{ tagName: "v0.5.6", isPrerelease: false, isDraft: false },
	{ tagName: "v0.5.5", isPrerelease: false, isDraft: false },
	{ tagName: "v0.5.0-rc.3", isPrerelease: true, isDraft: false },
	{ tagName: nightly(30, 99), isPrerelease: true, isDraft: true },
	...Array.from({ length: 14 }, (_, i) => ({
		tagName: nightly(i + 1, i + 1),
		isPrerelease: true,
		isDraft: false,
	})),
];
const registry = {
	versions: {
		"0.5.6": { prismalens: { release: { tag: nightly(2, 2) } } },
		"0.5.5": {},
	},
};

test("keeps the newest 10 nightlies and any a published launcher names; never a stable release", () => {
	const { remove } = plan(releases, protectedTags(registry), 10);
	assert.deepEqual(remove, [nightly(4, 4), nightly(3, 3), nightly(1, 1)]);
	for (const stable of ["v0.5.6", "v0.5.5", "v0.5.0-rc.3", nightly(30, 99)])
		assert.ok(!remove.includes(stable), stable);
	assert.deepEqual(
		plan(
			releases.filter((r) => !r.tagName.includes("nightly")),
			new Set(),
			0,
		).remove,
		[],
	);
});

test("the dry run prints exactly what it would delete", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-prune-"));
	writeFileSync(join(dir, "releases.json"), JSON.stringify(releases));
	writeFileSync(join(dir, "registry.json"), JSON.stringify(registry));
	const out = execFileSync(
		process.execPath,
		[
			fileURLToPath(new URL("./prune-nightlies.mjs", import.meta.url)),
			"--dry-run",
			"--releases",
			join(dir, "releases.json"),
			"--registry",
			join(dir, "registry.json"),
		],
		{ encoding: "utf8" },
	);
	assert.equal(
		out,
		`would delete ${nightly(4, 4)}\nwould delete ${nightly(3, 3)}\nwould delete ${nightly(1, 1)}\n`,
	);
});
