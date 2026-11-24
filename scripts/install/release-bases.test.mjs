// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Each runtime that downloads releases declares the default bases itself (shell, PowerShell and
// node share no module); this holds them to one pair of strings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_BASE, MIRROR_BASE } from "../launcher/launcher.mjs";

const read = (rel) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const urls = (text) =>
	text.match(
		/https:\/\/[^\s"'`)]*releases\/download|https:\/\/downloads\.prismalens\.io/g,
	) ?? [];

const MIRROR = "https://downloads.prismalens.io";
const GITHUB = "https://github.com/prismalens/prismalens/releases/download";

test("the launcher declares the mirror and the GitHub base", () => {
	assert.equal(MIRROR_BASE, MIRROR);
	assert.equal(DEFAULT_BASE, GITHUB);
});

for (const [file, rel, expected] of [
	["install.sh", "./install.sh", [MIRROR, GITHUB]],
	["install.ps1", "./install.ps1", [MIRROR, GITHUB]],
	[
		"update-check.ts",
		"../../packages/@prismalens/config/src/utils/update-check.ts",
		[GITHUB],
	],
	["release-complete.mjs", "../release-complete.mjs", [GITHUB]],
]) {
	test(`${file} declares exactly ${expected.length === 2 ? "the mirror, then GitHub" : "the GitHub base"}`, () => {
		assert.deepEqual(urls(read(rel)), expected);
	});
}

// The checksum is the release's own: no installer fetches SHA256SUMS from the base an archive loop
// is trying, only from the last base (GitHub, or the one PRISMALENS_RELEASE_BASE_URL names).
test("install.sh reads SHA256SUMS from its trusted base only", () => {
	const text = read("./install.sh");
	assert.match(text, /fetch "\$sums_base\/v\$1\/SHA256SUMS"/);
	assert.deepEqual(text.match(/"\$b\/v[^"]*SHA256SUMS"/g) ?? [], []);
});

test("install.ps1 reads SHA256SUMS from its trusted base only", () => {
	const text = read("./install.ps1");
	assert.match(text, /Fetch "\$sumsBase\/v\$Ver\/SHA256SUMS"/);
	assert.deepEqual(text.match(/"\$\(\$?base[^"]*SHA256SUMS"/gi) ?? [], []);
});

test("the launcher reads SHA256SUMS from its last base only", () => {
	const text = read("../launcher/launcher.mjs");
	assert.match(text, /expectedDigest\(want, bases\.at\(-1\), archive\)/);
	assert.deepEqual(
		text.match(/\$\{b\.base\}\/\$\{want\.tag\}\/SHA256SUMS/g) ?? [],
		[],
	);
});
