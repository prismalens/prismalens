#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs the real tarball, so it needs network and a built dist/.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NATIVE_COPIES, packAdapters, stage, THIRD_PARTY } from "./pack.mjs";

test("NATIVE_COPIES matches the platform packages and nothing else", () => {
	assert.ok(
		NATIVE_COPIES.test(
			"package/node_modules/@openai/codex-linux-x64/package.json",
		),
	);
	assert.ok(
		NATIVE_COPIES.test(
			"package/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/cli",
		),
	);
	assert.ok(
		!NATIVE_COPIES.test("package/node_modules/@openai/codex/package.json"),
	);
	assert.ok(
		!NATIVE_COPIES.test(
			"package/node_modules/@anthropic-ai/claude-agent-sdk/package.json",
		),
	);
});

test("the staged manifest is publishable and bundles every pin", () => {
	const staged = stage({
		name: "@prismalens/agent-adapters",
		private: true,
		scripts: { build: "tsc" },
		devDependencies: { typescript: "catalog:" },
		dependencies: { a: "1.0.0", b: "2.0.0" },
	});
	assert.equal(staged.private, undefined);
	assert.equal(staged.devDependencies, undefined);
	assert.deepEqual(staged.bundleDependencies, ["a", "b"]);
	assert.deepEqual(staged.dependencies, { a: "1.0.0", b: "2.0.0" });
	assert.equal(staged.publishConfig.access, "public");
});

test("the packed tarball bundles the adapters, no native copy, and every licence text", () => {
	const { tarball, entries } = packAdapters({
		outDir: mkdtempSync(join(tmpdir(), "adapters-out-")),
	});
	assert.equal(entries.filter((e) => NATIVE_COPIES.test(e)).length, 0);
	assert.ok(entries.includes("package/LICENSE"));
	assert.ok(entries.includes("package/dist/index.js"));
	for (const { pkg, files } of THIRD_PARTY) {
		for (const file of files.length ? files : ["LICENSE"]) {
			assert.ok(
				entries.includes(`package/THIRD_PARTY_LICENSES/${pkg}/${file}`),
				`${pkg}/${file}`,
			);
		}
	}
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", tarball, "package/package.json"], {
			encoding: "utf8",
		}),
	);
	assert.equal(manifest.private, undefined);
	assert.deepEqual(
		manifest.bundleDependencies,
		Object.keys(manifest.dependencies),
	);
});
