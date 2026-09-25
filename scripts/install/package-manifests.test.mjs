#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests the Homebrew formula and Scoop manifest in scripts/install/package-manifests.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { formula, parseSums, scoopManifest } from "./package-manifests.mjs";

const SUMS = parseSums(
	[
		"aa  prismalens-1.2.3-darwin-arm64.tar.gz",
		"bb  prismalens-1.2.3-darwin-x64.tar.gz",
		"cc *prismalens-1.2.3-linux-arm64.tar.gz",
		"DD  prismalens-1.2.3-linux-x64.tar.gz",
		"ee  prismalens-1.2.3-win32-x64.zip",
	].join("\n"),
);
const BASE = "https://example.test/v1.2.3";

test("the formula pairs each platform's archive with its own hash", () => {
	const rb = formula({ version: "1.2.3", baseUrl: BASE, sums: SUMS });
	for (const [target, hash] of [
		["darwin-arm64", "aa"],
		["darwin-x64", "bb"],
		["linux-arm64", "cc"],
		["linux-x64", "dd"],
	]) {
		assert.match(
			rb,
			new RegExp(`url "${BASE}/prismalens-1\\.2\\.3-${target}\\.tar\\.gz"\\n\\s+sha256 "${hash}"`),
		);
	}
	assert.match(rb, /on_macos do\n\s+on_arm do[\s\S]*darwin-arm64/);
	assert.match(rb, /bin\.install_symlink libexec\/"bin\/pl", libexec\/"bin\/prismalens"/);
});

test("the Scoop manifest points at the Windows zip and its extract dir", () => {
	const manifest = JSON.parse(scoopManifest({ version: "1.2.3", baseUrl: BASE, sums: SUMS }));
	assert.equal(manifest.version, "1.2.3");
	assert.deepEqual(manifest.architecture["64bit"], {
		url: `${BASE}/prismalens-1.2.3-win32-x64.zip`,
		hash: "ee",
		extract_dir: "prismalens-1.2.3-win32-x64",
	});
	assert.deepEqual(manifest.bin, [
		["bin\\pl.cmd", "pl"],
		["bin\\prismalens.cmd", "prismalens"],
	]);
});

test("a missing archive fails unless --allow-missing", () => {
	const partial = parseSums("aa  prismalens-1.2.3-darwin-arm64.tar.gz");
	assert.throws(
		() => formula({ version: "1.2.3", baseUrl: BASE, sums: partial }),
		/darwin-x64\.tar\.gz is not in SHA256SUMS/,
	);
	assert.throws(
		() => scoopManifest({ version: "1.2.3", baseUrl: BASE, sums: partial }),
		/win32-x64\.zip is not in SHA256SUMS/,
	);
	const rb = formula({ version: "1.2.3", baseUrl: BASE, sums: partial, allowMissing: true });
	assert.match(rb, /darwin-arm64/);
	assert.doesNotMatch(rb, /on_linux|darwin-x64/);
});
