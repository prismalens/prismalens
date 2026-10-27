// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { installWithRetry } from "./npm-install-retry.mjs";

function fake(results) {
	const calls = [];
	const slept = [];
	return {
		calls,
		slept,
		run: (cmd, args) => {
			calls.push([cmd, ...args]);
			return results.shift();
		},
		sleep: (s) => slept.push(s),
		log: () => {},
		stdout: "ignore",
	};
}

const ok = { status: 0, stdout: "added 1 package", stderr: "" };
const e404 = {
	status: 1,
	stdout: "",
	stderr:
		"npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/svix/-/svix-2.9.0.tgz",
};

test("a propagation 404 is retried with backoff until the install passes", () => {
	const f = fake([e404, { ...e404, stderr: "npm error code ETARGET" }, ok]);
	assert.equal(
		installWithRetry("npm", ["install", "x.tgz"], f),
		"added 1 package",
	);
	assert.equal(f.calls.length, 3);
	assert.deepEqual(f.slept, [15, 30]);
});

test("any other failure is not retried", () => {
	const f = fake([
		{ status: 1, stdout: "", stderr: "npm error code EBADENGINE" },
	]);
	assert.throws(() => installWithRetry("npm", ["install"], f), /exited 1/);
	assert.equal(f.calls.length, 1);
});

test("the retries are bounded", () => {
	const f = fake([e404, e404, e404]);
	assert.throws(
		() => installWithRetry("npm", ["install"], { ...f, delays: [1, 2] }),
		/exited 1/,
	);
	assert.equal(f.calls.length, 3);
	assert.deepEqual(f.slept, [1, 2]);
});
