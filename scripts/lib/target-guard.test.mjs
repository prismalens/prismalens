// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { targetGuard } from "./target-guard.mjs";

const fakeApp = () => {
	const app = {
		stops: 0,
		cleanup: async () => {
			app.stops++;
		},
	};
	return app;
};

test("a signal during boot stops the target once boot returns and runs no journey", async () => {
	const codes = [];
	const guard = targetGuard((code) => codes.push(code));
	const app = fakeApp();
	await guard.cleanup(130);
	assert.equal(app.stops, 0);
	await assert.rejects(guard.adopt(app), {
		message: "cancelled while the target was booting",
	});
	assert.equal(app.stops, 1);
	await guard.cleanup(1);
	assert.equal(app.stops, 1);
	assert.deepEqual(codes, [130]);
});

test("a target adopted before any signal is stopped once, by the first cleanup", async () => {
	const codes = [];
	const guard = targetGuard((code) => codes.push(code));
	const app = fakeApp();
	assert.equal(await guard.adopt(app), app);
	assert.equal(app.stops, 0);
	await guard.cleanup(0);
	await guard.cleanup(143);
	assert.equal(app.stops, 1);
	assert.deepEqual(codes, [0]);
});
