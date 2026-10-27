// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { retest, wanted } from "./agent-tested.mjs";

const HARNESS = readFileSync(
	new URL(
		"../packages/@prismalens/config/src/providers/harness.ts",
		import.meta.url,
	),
	"utf8",
);
const pins = JSON.parse(
	readFileSync(new URL("./agent-pins.json", import.meta.url), "utf8"),
).pins;
const adapters = JSON.parse(
	readFileSync(
		new URL(
			"../packages/@prismalens/agent-adapters/package.json",
			import.meta.url,
		),
		"utf8",
	),
).devDependencies;

test("rows already on their pins stay byte for byte", () => {
	const { source, moved } = retest(
		HARNESS,
		wanted(pins, adapters),
		"2099-01-01",
	);
	assert.deepEqual(moved, []);
	assert.equal(source, HARNESS);
});

test("a moved pin rewrites only its row's tested line and the note above it", () => {
	const rows = wanted(
		{ ...pins, "@anthropic-ai/claude-code": "9.9.9" },
		{ ...adapters, "@agentclientprotocol/codex-acp": "8.8.8" },
	);
	const { source, moved } = retest(HARNESS, rows, "2099-01-01");
	assert.deepEqual(moved, ["claude-code", "codex"]);
	assert.ok(
		source.includes(
			`tested: { version: "${adapters["@agentclientprotocol/claude-agent-acp"]}", date: "2099-01-01", companion: "9.9.9" },`,
		),
	);
	assert.match(source, /tested: \{ version: "8\.8\.8", date: "2099-01-01" \},/);
	assert.equal(source.split("\n").length, HARNESS.split("\n").length);
	assert.equal((source.match(/no real-model run yet/g) ?? []).length, 2);
	const opencode = /^\t\ttested: \{ version: "[^"]*", date: "[^"]*" \},$/m.exec(
		HARNESS,
	)?.[0];
	assert.ok(opencode && source.includes(opencode));
});
