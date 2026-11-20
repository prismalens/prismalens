// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** One-command setup and the reused build (#1133). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDecision } from "./build-cache.mjs";
import { runSteps } from "./setup-worktree.mjs";

const KEY = "a1b2c3d4e5f6a7b8c9d0";
const BUILT = { key: KEY, index: "idx-1", api: "api-1" };

test("unchanged sources and intact output reuse the build and say so with the key", () => {
	assert.deepEqual(
		buildDecision({
			force: false,
			key: KEY,
			last: BUILT,
			index: "idx-1",
			api: "api-1",
		}),
		{
			reuse: true,
			line: "reused the build: sources unchanged since the last build here (a1b2c3d4e5f6)",
		},
	);
});

test("a changed source rebuilds and names the change", () => {
	assert.deepEqual(
		buildDecision({
			force: false,
			key: "ffff0000",
			last: BUILT,
			index: "idx-1",
			api: "api-1",
		}),
		{ reuse: false, line: "rebuilding (sources changed since the last build)" },
	);
});

test("--rebuild forces a build over unchanged sources", () => {
	assert.deepEqual(
		buildDecision({
			force: true,
			key: KEY,
			last: BUILT,
			index: "idx-1",
			api: "api-1",
		}),
		{
			reuse: false,
			line: "rebuilding (--rebuild)",
		},
	);
});

test("a checkout with no recorded build builds", () => {
	assert.deepEqual(
		buildDecision({ force: false, key: KEY, last: {}, index: null, api: null }),
		{
			reuse: false,
			line: "rebuilding (no build recorded in this checkout)",
		},
	);
});

test("output replaced by another build, or missing, rebuilds", () => {
	const replaced = {
		reuse: false,
		line: "rebuilding (the build output was replaced or removed)",
	};
	assert.deepEqual(
		buildDecision({
			force: false,
			key: KEY,
			last: BUILT,
			index: "idx-2",
			api: "api-1",
		}),
		replaced,
	);
	assert.deepEqual(
		buildDecision({
			force: false,
			key: KEY,
			last: BUILT,
			index: null,
			api: "api-1",
		}),
		replaced,
	);
});

test("an API output replaced or removed under unchanged sources rebuilds", () => {
	const replaced = {
		reuse: false,
		line: "rebuilding (the API output was replaced or removed)",
	};
	assert.deepEqual(
		buildDecision({
			force: false,
			key: KEY,
			last: BUILT,
			index: "idx-1",
			api: "api-2",
		}),
		replaced,
	);
	assert.deepEqual(
		buildDecision({
			force: false,
			key: KEY,
			last: BUILT,
			index: "idx-1",
			api: null,
		}),
		replaced,
	);
	assert.deepEqual(
		buildDecision({
			force: false,
			key: KEY,
			last: { key: KEY, index: "idx-1" },
			index: "idx-1",
			api: "api-1",
		}),
		replaced,
	);
});

test("setup stops at the first failing step with its output and exit code, and returns 1", () => {
	/** @type {string[]} */
	const out = [];
	/** @type {string[]} */
	const err = [];
	/** @type {string[]} */
	const ran = [];
	let t = 0;
	const code = runSteps(
		[
			["install", () => ran.push("install")],
			[
				"prisma client",
				() => {
					ran.push("prisma client");
					throw Object.assign(new Error("boom"), {
						status: 7,
						stderr: "prisma: no schema",
					});
				},
			],
			["registry", () => ran.push("registry")],
		],
		{
			out: (m) => out.push(m),
			err: (m) => err.push(m),
			now: () => (t += 1500),
		},
	);
	assert.equal(code, 1);
	assert.deepEqual(ran, ["install", "prisma client"]);
	assert.deepEqual(out, ["[setup] install ok 1.5s"]);
	assert.deepEqual(err, [
		"prisma: no schema",
		"[setup] prisma client FAILED after 1.5s (exit 7); its output is above. Fix it and run pnpm setup:worktree again.",
	]);
});

test("setup runs every step and returns 0 with a timed line each", () => {
	/** @type {string[]} */
	const out = [];
	let t = 0;
	const code = runSteps(
		[
			["install", () => {}],
			["build", () => {}],
		],
		{ out: (m) => out.push(m), err: () => {}, now: () => (t += 1000) },
	);
	assert.equal(code, 0);
	assert.deepEqual(out, [
		"[setup] install ok 1.0s",
		"[setup] build ok 1.0s",
		"[setup] ready in 5.0s",
	]);
});
