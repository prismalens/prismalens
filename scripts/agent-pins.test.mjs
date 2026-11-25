// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AGENTS_DIR, agentPins, ROOT, readPins } from "./agent-pins.mjs";

const adapters = JSON.parse(
	readFileSync(
		join(ROOT, "packages/@prismalens/agent-adapters/package.json"),
		"utf8",
	),
).devDependencies;

test("each pin.json's adapter is the version agent-adapters installs", () => {
	const pinned = agentPins().filter((p) => p.adapter);
	assert.deepEqual(
		pinned.map((p) => [p.agent, p.adapter.version]),
		pinned.map((p) => [p.agent, adapters[p.adapter.package]]),
	);
});

test("each pin.json sits beside its agent's descriptor", () => {
	assert.deepEqual(
		agentPins()
			.map((p) => p.agent)
			.filter(
				(a) => !existsSync(join(ROOT, AGENTS_DIR, a, `${a}.provider.ts`)),
			),
		[],
	);
});

test("pins key by CLI package, and every agent soaks 3 days unless its pin says otherwise", () => {
	assert.deepEqual(
		Object.keys(readPins()),
		agentPins().map((p) => p.cli.package),
	);
	assert.deepEqual(
		agentPins().map((p) => p.minimumReleaseAgeDays),
		agentPins().map(() => 3),
	);
});
