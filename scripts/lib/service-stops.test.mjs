// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { stopsOnce } from "./service-stops.mjs";

test("a cgroup stop is one shutdown whichever of the signal and the request lands first", () => {
	assert.equal(stopsOnce("cgroup", 1, 0), true);
	assert.equal(stopsOnce("cgroup", 1, 1), true);
	assert.equal(
		stopsOnce("cgroup", 2, 1),
		true,
		"request first, then the real signal",
	);
	assert.equal(
		stopsOnce("cgroup", 2, 0),
		false,
		"two signals and no request is a second stop",
	);
	assert.equal(stopsOnce("main", 1, 1), true);
	assert.equal(stopsOnce("main", 1, 0), false);
	assert.equal(stopsOnce("main", 2, 1), false);
});
