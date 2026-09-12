#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests resolvePublishTag in scripts/pack-cli.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePublishTag } from "./pack-cli.mjs";

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
