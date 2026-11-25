// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { descriptorOf, retest, wanted } from "./agent-tested.mjs";

const SOURCES = Object.fromEntries(
	["opencode", "claude-code", "codex"].map((id) => [
		id,
		readFileSync(descriptorOf(id), "utf8"),
	]),
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

test("descriptors already on their pins stay byte for byte", () => {
	const { sources, moved } = retest(
		SOURCES,
		wanted(pins, adapters),
		"2099-01-01",
	);
	assert.deepEqual(moved, []);
	assert.deepEqual(sources, SOURCES);
});

test("a moved pin rewrites only its descriptor's tested line and the note above it", () => {
	const rows = wanted(
		{ ...pins, "@anthropic-ai/claude-code": "9.9.9" },
		{ ...adapters, "@agentclientprotocol/codex-acp": "8.8.8" },
	);
	const { sources, moved } = retest(SOURCES, rows, "2099-01-01");
	assert.deepEqual(moved, ["claude-code", "codex"]);
	assert.equal(sources.opencode, SOURCES.opencode);
	assert.ok(
		sources["claude-code"].includes(
			`tested: { version: "${adapters["@agentclientprotocol/claude-agent-acp"]}", date: "2099-01-01", companion: "9.9.9" },`,
		),
	);
	assert.ok(
		sources.codex.includes(
			`tested: { version: "8.8.8", date: "2099-01-01", companion: "${pins["@openai/codex"]}" },`,
		),
	);
	// A descriptor may already carry the note from an earlier bump, so look above each moved line.
	for (const [id, marker] of [
		["codex", 'version: "8.8.8"'],
		["claude-code", 'companion: "9.9.9"'],
	]) {
		const lines = sources[id].split("\n");
		const at = lines.findIndex(
			(l) => l.includes("tested:") && l.includes(marker),
		);
		assert.match(lines[at - 1], /no real-model run yet/);
		assert.equal(
			lines
				.filter(
					(l) => !l.includes("tested:") && !l.includes("no real-model run yet"),
				)
				.join("\n"),
			SOURCES[id]
				.split("\n")
				.filter(
					(l) => !l.includes("tested:") && !l.includes("no real-model run yet"),
				)
				.join("\n"),
		);
	}
});

test("a codex-only bump moves the codex descriptor", () => {
	const rows = wanted({ ...pins, "@openai/codex": "7.7.7" }, adapters);
	const { sources, moved } = retest(SOURCES, rows, "2099-01-01");
	assert.deepEqual(moved, ["codex"]);
	assert.ok(
		sources.codex.includes(`date: "2099-01-01", companion: "7.7.7" },`),
	);
});

test("a descriptor with no tested line is refused by name", () => {
	assert.throws(
		() =>
			retest(
				{ opencode: "export const x = {};" },
				{ opencode: { version: "1.0.0" } },
				"2099-01-01",
			),
		{ message: "no tested line in the opencode descriptor" },
	);
});
