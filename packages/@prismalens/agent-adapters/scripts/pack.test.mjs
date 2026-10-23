#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs the real tarball, so it needs a built dist/ (`pnpm build`).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { NATIVE_COPIES, packAdapters, SDK, stage } from "./pack.mjs";

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
		dependencies: { [SDK]: "1.0.0" },
	});
	assert.equal(staged.private, undefined);
	assert.equal(staged.devDependencies, undefined);
	assert.deepEqual(staged.bundleDependencies, [SDK]);
	assert.deepEqual(staged.dependencies, { [SDK]: "1.0.0" });
	assert.equal(staged.publishConfig.access, "public");
});

test("the packed tarball carries the bundles, the SDK flat, no native copy, and every licence text", () => {
	const { tarball, entries } = packAdapters({
		outDir: mkdtempSync(join(tmpdir(), "adapters-out-")),
	});
	assert.equal(entries.filter((e) => NATIVE_COPIES.test(e)).length, 0);
	assert.ok(entries.includes("package/LICENSE"));
	assert.ok(entries.includes("package/dist/index.js"));
	assert.ok(entries.includes("package/dist/adapters/bundled.json"));
	assert.ok(
		!entries.some((e) => e.startsWith("package/dist/adapters/licenses/")),
	);
	assert.ok(
		!entries.some((e) => /^package\/node_modules\/.+\/node_modules\//.test(e)),
		"nothing nests under the SDK",
	);
	const bundled = JSON.parse(
		readFileSync(
			new URL("../dist/adapters/bundled.json", import.meta.url),
			"utf8",
		),
	);
	const names = new Set([SDK]);
	for (const { script, inlined } of Object.values(bundled)) {
		assert.ok(entries.includes(`package/dist/adapters/${script}`), script);
		for (const i of inlined) names.add(i.slice(0, i.lastIndexOf("@")));
	}
	for (const name of names) {
		assert.ok(
			entries.some((e) =>
				e.startsWith(`package/THIRD_PARTY_LICENSES/${name}/`),
			),
			name,
		);
	}
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", basename(tarball), "package/package.json"], {
			cwd: dirname(tarball),
			encoding: "utf8",
		}),
	);
	assert.equal(manifest.private, undefined);
	assert.equal(manifest.devDependencies, undefined);
	assert.deepEqual(Object.keys(manifest.dependencies), [SDK]);
	assert.deepEqual(manifest.bundleDependencies, [SDK]);
	const sdk = JSON.parse(
		execFileSync(
			"tar",
			["-xzOf", basename(tarball), `package/node_modules/${SDK}/package.json`],
			{
				cwd: dirname(tarball),
				encoding: "utf8",
			},
		),
	);
	assert.equal(sdk.optionalDependencies, undefined);
	assert.equal(sdk.peerDependencies, undefined);
});
