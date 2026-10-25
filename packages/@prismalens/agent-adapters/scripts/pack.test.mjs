#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Packs the real tarball, so it needs network and a built dist/.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import {
	NATIVE_COPIES,
	packAdapters,
	run,
	stage,
	THIRD_PARTY,
	UNUSED_PEERS,
	unfetchable,
} from "./pack.mjs";

// Measured on win32-x64: 18.8 MB, and 707.3 MB before the bundled manifests were rewritten (#916).
const CONSUMER_INSTALL_LIMIT_MB = 40;

let packed;
const pack = () => {
	packed ??= packAdapters({
		outDir: mkdtempSync(join(tmpdir(), "adapters-out-")),
	});
	return packed;
};

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

test("a bundled manifest keeps only what a consumer may fetch", () => {
	const manifest = {
		optionalDependencies: {
			"@openai/codex-linux-x64": "npm:@openai/codex@0.160.1-linux-x64",
			fsevents: "2.3.3",
		},
		peerDependencies: {
			"@anthropic-ai/sdk": ">=0.93.0",
			"@modelcontextprotocol/sdk": "^1.29.0",
			zod: "^4.0.0",
		},
	};
	assert.ok(unfetchable(manifest));
	assert.deepEqual(manifest, {
		optionalDependencies: { fsevents: "2.3.3" },
		peerDependencies: { zod: "^4.0.0" },
	});
	assert.ok(!unfetchable(manifest));
	const sdkOnly = {
		optionalDependencies: { "@anthropic-ai/claude-agent-sdk-win32-x64": "1" },
	};
	assert.ok(unfetchable(sdkOnly));
	assert.deepEqual(sdkOnly, {});
});

test("the packed tarball bundles the adapters, no native copy, and every licence text", () => {
	const { tarball, entries } = pack();
	assert.equal(entries.filter((e) => NATIVE_COPIES.test(e)).length, 0);
	assert.ok(entries.includes("package/LICENSE"));
	assert.ok(entries.includes("package/dist/index.js"));
	for (const { pkg, files, vendored = [] } of THIRD_PARTY) {
		for (const file of [...(files.length ? files : ["LICENSE"]), ...vendored]) {
			assert.ok(
				entries.includes(`package/THIRD_PARTY_LICENSES/${pkg}/${file}`),
				`${pkg}/${file}`,
			);
		}
	}
	const manifest = JSON.parse(
		run(
			"tar",
			["-xzOf", basename(tarball), "package/package.json"],
			dirname(tarball),
		),
	);
	assert.equal(manifest.private, undefined);
	assert.deepEqual(
		manifest.bundleDependencies,
		Object.keys(manifest.dependencies),
	);
});

function walk(dir, found = { bytes: 0, packages: [] }) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				basename(dir) === "node_modules" ||
				basename(dirname(dir)) === "node_modules"
			)
				found.packages.push(path.replaceAll("\\", "/"));
			walk(path, found);
		} else found.bytes += statSync(path).size;
	}
	return found;
}

test("a consumer's install pulls no native copy and no unused peer", () => {
	const { tarball } = pack();
	const consumer = mkdtempSync(join(tmpdir(), "adapters-consumer-"));
	writeFileSync(
		join(consumer, "package.json"),
		'{ "name": "consumer", "version": "1.0.0", "private": true }\n',
	);
	const flags = ["--no-audit", "--no-fund", "--loglevel", "warn"];
	run("npm", ["install", tarball, ...flags], consumer);
	// The first install leaves bundled deps alone; the second, from the lockfile, fetches them (#916).
	run("npm", ["install", ...flags], consumer);

	const { bytes, packages } = walk(join(consumer, "node_modules"));
	const forbidden = packages.filter(
		(path) =>
			NATIVE_COPIES.test(path) ||
			UNUSED_PEERS.some((peer) => path.endsWith(`node_modules/${peer}`)),
	);
	const mb = bytes / 1024 / 1024;
	console.log(`consumer install: ${mb.toFixed(1)} MB`);
	assert.deepEqual(forbidden, []);
	assert.ok(
		mb < CONSUMER_INSTALL_LIMIT_MB,
		`${mb.toFixed(1)} MB is over ${CONSUMER_INSTALL_LIMIT_MB} MB`,
	);
});
