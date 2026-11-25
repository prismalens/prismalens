// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPins } from "./agent-pins.mjs";
import { retest } from "./agent-tested.mjs";

const pin = (over = {}) => ({
	cli: { package: "@acme/cli", version: "2.0.0", channel: "npm" },
	adapter: { package: "@acme/acp", version: "1.0.0" },
	tested: { version: "1.0.0", date: "2026-01-01", companion: "2.0.0" },
	...over,
});

test("every agent's tested already follows its pins", () => {
	assert.deepEqual(
		agentPins().map((p) => [p.agent, retest(p, "2099-01-01")]),
		agentPins().map((p) => [p.agent, null]),
	);
});

test("a moved CLI moves the companion; a moved adapter moves the version", () => {
	assert.deepEqual(
		retest(
			pin({ cli: { package: "@acme/cli", version: "2.1.0", channel: "npm" } }),
			"2099-01-01",
		).tested,
		{ version: "1.0.0", companion: "2.1.0", date: "2099-01-01" },
	);
	assert.deepEqual(
		retest(
			pin({ adapter: { package: "@acme/acp", version: "1.1.0" } }),
			"2099-01-01",
		).tested,
		{ version: "1.1.0", companion: "2.0.0", date: "2099-01-01" },
	);
});

test("a CLI with no adapter is tested on its own version", () => {
	const alone = {
		cli: { package: "acme", version: "3.0.0", channel: "npm" },
		tested: { version: "2.0.0", date: "2026-01-01" },
	};
	assert.deepEqual(retest(alone, "2099-01-01").tested, {
		version: "3.0.0",
		date: "2099-01-01",
	});
});

test("a pin no compatibility run recorded stays untested, and a Python pin keeps its hand-recorded run", () => {
	assert.equal(retest(pin({ tested: undefined }), "2099-01-01"), null);
	assert.equal(
		retest(
			pin({ cli: { package: "acme", version: "9.0.0", channel: "pypi" } }),
			"2099-01-01",
		),
		null,
	);
});
