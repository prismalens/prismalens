// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { wantedSdk } from "./agent-adapter-sdk.mjs";

const adapters = {
	"@agentclientprotocol/claude-agent-acp": "0.95.0",
	"@agentclientprotocol/codex-acp": "2.2.2",
	"@agentclientprotocol/sdk": "1.9.0",
	esbuild: "^0.28.1",
};

test("the SDK the claude adapter declares is the one shipped", () => {
	const declared = (name) => (name.includes("claude") ? "0.3.309" : null);
	assert.equal(wantedSdk(adapters, declared), "0.3.309");
});

test("only *-acp adapters are asked", () => {
	const asked = [];
	wantedSdk(adapters, (name) => {
		asked.push(name);
		return null;
	});
	assert.deepEqual(asked, [
		"@agentclientprotocol/claude-agent-acp",
		"@agentclientprotocol/codex-acp",
	]);
});

test("adapters that disagree fail", () => {
	assert.throws(
		() => wantedSdk(adapters, (name) => (name.includes("claude") ? "1" : "2")),
		/different/,
	);
});
