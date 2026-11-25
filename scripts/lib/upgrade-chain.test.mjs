// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	candidateVersion,
	draftPlan,
	hops,
	releasesFrom,
} from "./upgrade-chain.mjs";

const PUBLISHED = [
	"0.4.0",
	"0.5.0-rc.0",
	"0.5.0-rc.3",
	"0.5.0",
	"0.5.1",
	"0.5.2",
	"0.5.10",
];

test("the chain walks the stable releases from 0.5.0, oldest first, in version order", () => {
	assert.deepEqual(releasesFrom(PUBLISHED), [
		"0.5.0",
		"0.5.1",
		"0.5.2",
		"0.5.10",
	]);
	assert.deepEqual(releasesFrom(["0.4.0", "0.5.0-rc.1"]), []);
});

test("a tarball ahead of npm keeps its own version; one npm already has moves to the next patch", () => {
	assert.equal(candidateVersion("0.5.11", PUBLISHED), "0.5.11");
	assert.equal(candidateVersion("0.5.2", PUBLISHED), "0.5.11");
	assert.equal(candidateVersion("0.5.1", PUBLISHED), "0.5.11");
	assert.equal(candidateVersion("0.6.0-rc.1", PUBLISHED), "0.6.0-rc.1");
	assert.equal(candidateVersion("1.0.0", []), "1.0.0");
});

test("a draft keeps its own version and upgrades from the releases below it, even when npm holds a newer one", () => {
	assert.deepEqual(draftPlan("0.5.11", PUBLISHED), {
		candidate: "0.5.11",
		releases: ["0.5.0", "0.5.1", "0.5.2", "0.5.10"],
	});
	assert.deepEqual(draftPlan("0.5.3", PUBLISHED), {
		candidate: "0.5.3",
		releases: ["0.5.0", "0.5.1", "0.5.2"],
	});
	assert.deepEqual(draftPlan("0.5.1-hotfix", ["0.5.0", "0.5.2"]), {
		candidate: "0.5.1-hotfix",
		releases: ["0.5.0"],
	});
	assert.deepEqual(draftPlan("0.5.0", ["0.5.1"]), {
		candidate: "0.5.0",
		releases: [],
	});
});

test("a draft whose exact version npm already lists is refused", () => {
	assert.throws(() => draftPlan("0.5.2", PUBLISHED), {
		message:
			"0.5.2 is already on npm; a release proof needs an unpublished one",
	});
});

test("each release steps to the next, the newest to the candidate, and the oldest also skips to it", () => {
	assert.deepEqual(hops(["0.5.0", "0.5.1", "0.5.2"], "0.5.3"), [
		{ from: "0.5.0", to: "0.5.1", kind: "step" },
		{ from: "0.5.1", to: "0.5.2", kind: "step" },
		{ from: "0.5.2", to: "0.5.3", kind: "step" },
		{ from: "0.5.0", to: "0.5.3", kind: "skip" },
	]);
	assert.deepEqual(hops(["0.5.0"], "0.5.1"), [
		{ from: "0.5.0", to: "0.5.1", kind: "step" },
	]);
});
