#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests resolvePublishTag in scripts/pack-cli.mjs.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	nativeCopyOffenders,
	resolveBuildSha,
	resolvePublishTag,
} from "./pack-cli.mjs";

/** A workspace package `owner` whose node_modules holds `dep` with this manifest. */
function workspaceWith(owner, dep, depManifest) {
	const root = mkdtempSync(join(tmpdir(), "pack-cli-test-"));
	const dir = join(root, "engine");
	const depDir = join(dir, "node_modules", ...dep.split("/"));
	mkdirSync(depDir, { recursive: true });
	writeFileSync(join(depDir, "package.json"), JSON.stringify(depManifest));
	return { root, workspace: new Map([[owner, { dir, manifest: {} }]]) };
}

test("a registry dependency whose optional deps are agent native copies is reported (#1269)", () => {
	const sdk = "@anthropic-ai/claude-agent-sdk";
	const { root, workspace } = workspaceWith("@prismalens/engine", sdk, {
		name: sdk,
		optionalDependencies: {
			"@anthropic-ai/claude-agent-sdk-linux-x64": "0.3.328",
			"@anthropic-ai/claude-agent-sdk-win32-x64": "0.3.328",
			"some-other-optional": "1.0.0",
		},
	});
	try {
		const union = new Map([
			[sdk, { range: "0.3.328", requiredBy: ["@prismalens/engine"] }],
		]);
		assert.deepEqual(nativeCopyOffenders(union, workspace), [
			"@anthropic-ai/claude-agent-sdk (from @prismalens/engine) would install " +
				"@anthropic-ai/claude-agent-sdk-linux-x64, @anthropic-ai/claude-agent-sdk-win32-x64",
		]);
		// Hoisted from the nested copy, the SDK leaves the union and nothing is reported.
		union.delete(sdk);
		assert.deepEqual(nativeCopyOffenders(union, workspace), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a registry dependency with ordinary optional deps is not reported", () => {
	const { root, workspace } = workspaceWith("@prismalens/engine", "chokidar", {
		name: "chokidar",
		optionalDependencies: { fsevents: "2.3.3" },
	});
	try {
		const union = new Map([
			["chokidar", { range: "^4.0.0", requiredBy: ["@prismalens/engine"] }],
		]);
		assert.deepEqual(nativeCopyOffenders(union, workspace), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("returns 'latest' for a plain release version without prerelease tag", () => {
	const tag = resolvePublishTag({
		tagArg: null,
		rootDir: "/nonexistent-dir",
		version: "0.5.0",
	});
	assert.equal(tag, "latest");
});

test("returns prerelease identifier from version string (0.5.0-rc.0 -> rc)", () => {
	const tag = resolvePublishTag({
		tagArg: null,
		rootDir: "/nonexistent-dir",
		version: "0.5.0-rc.0",
	});
	assert.equal(tag, "rc");
});

test("returns prerelease identifier for alpha/beta versions", () => {
	assert.equal(
		resolvePublishTag({
			tagArg: null,
			rootDir: "/nonexistent-dir",
			version: "0.5.0-alpha.1",
		}),
		"alpha",
	);
	assert.equal(
		resolvePublishTag({
			tagArg: null,
			rootDir: "/nonexistent-dir",
			version: "0.5.0-beta-2",
		}),
		"beta",
	);
});

test("fails closed (throws) on unrecognized numeric prerelease versions like 0.5.0-0", () => {
	assert.throws(
		() =>
			resolvePublishTag({
				tagArg: null,
				rootDir: "/nonexistent-dir",
				version: "0.5.0-0",
			}),
		(err) => {
			assert(err instanceof Error);
			assert.match(err.message, /0\.5\.0-0/);
			assert.match(err.message, /--tag/);
			assert.match(err.message, /Refusing to publish prerelease version/);
			return true;
		},
	);
});

test("explicit --tag permits publishing unrecognized prerelease versions", () => {
	const tag = resolvePublishTag({
		tagArg: "next",
		rootDir: "/nonexistent-dir",
		version: "0.5.0-0",
	});
	assert.equal(tag, "next");
});

test("refuses to publish prerelease version to dist-tag latest", () => {
	assert.throws(
		() =>
			resolvePublishTag({
				tag: "latest",
				version: "0.5.4-nightly.20261111.812",
			}),
		(err) => {
			assert(err instanceof Error);
			assert.equal(
				err.message,
				'Refusing to publish prerelease version "0.5.4-nightly.20261111.812" to dist-tag "latest".',
			);
			return true;
		},
	);
});

test("resolves nightly dist-tag when tag is explicit or omitted for nightly version", () => {
	assert.equal(
		resolvePublishTag({
			tag: "nightly",
			version: "0.5.4-nightly.20261111.812",
		}),
		"nightly",
	);
	assert.equal(
		resolvePublishTag({
			version: "0.5.4-nightly.20261111.812",
		}),
		"nightly",
	);
});

test("resolveBuildSha prefers GITHUB_SHA sliced to short sha in CI", () => {
	const sha = resolveBuildSha({
		env: { GITHUB_SHA: "1234567890abcdef1234567890abcdef12345678" },
	});
	assert.equal(sha, "1234567");
});

test("resolveBuildSha falls back to git rev-parse --short HEAD", () => {
	const sha = resolveBuildSha({
		env: {},
		runGit: () => "abcdef1",
	});
	assert.equal(sha, "abcdef1");
});

test("resolveBuildSha returns undefined when git fails and GITHUB_SHA is absent", () => {
	const sha = resolveBuildSha({
		env: {},
		runGit: () => {
			throw new Error("fatal: not a git repository");
		},
	});
	assert.equal(sha, undefined);
});
