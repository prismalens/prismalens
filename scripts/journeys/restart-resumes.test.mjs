// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { replayedCalls } from "./restart-resumes.mjs";

const step = (/** @type {string} */ id) => ({
	kind: "agent_step",
	toolCalls: [{ toolCallId: id }],
});
const result = (/** @type {string} */ id) => ({
	kind: "tool_result",
	result: { toolCallId: id },
});

// A finished before the first look; B finished between that look and the stop (#981).
const baseline = [step("A"), result("A"), step("B"), result("B")];

test("a call that finished just before the stop and runs again after it is a replay", () => {
	assert.deepEqual(
		replayedCalls(baseline, [...baseline, step("B"), result("B")]),
		["step:B", "result:B"],
	);
});

test("a call from before the first look that runs again is a replay", () => {
	assert.deepEqual(replayedCalls(baseline, [...baseline, step("A")]), [
		"step:A",
	]);
});

test("a call the run had not made before the stop is not a replay", () => {
	assert.deepEqual(
		replayedCalls(baseline, [...baseline, step("C"), result("C")]),
		[],
	);
});
