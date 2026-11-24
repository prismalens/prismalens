// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetLine, overBudget } from "./timeout-budget-reporter.mjs";

const result = (name, duration, timeout, state = "passed") => ({
	file: "a.spec.ts",
	name,
	duration,
	timeout,
	state,
});

test("a passed test over its share of its own timeout is named, the most used first (#1085)", () => {
	// The thread-tree spec that timed out on macOS took 6589 ms against 5000; at 2.5x slower that is ~2.6 s here.
	const over = overBudget(
		[
			result("thread-tree batch", 2600, 5000),
			result("restart scenario", 56_000, 120_000),
			result("quick", 300, 5000),
			result("cron", 4900, 5000),
			result("failed already", 4999, 5000, "failed"),
		],
		0.4,
	);
	assert.deepEqual(
		over.map((r) => r.name),
		["cron", "thread-tree batch", "restart scenario"],
	);
	assert.equal(
		budgetLine(over[1]),
		"2600 ms of 5000 ms (52%): a.spec.ts > thread-tree batch",
	);
});
