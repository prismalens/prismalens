// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	channelPackage,
	keyless,
	plan,
	shown,
	verdict,
} from "./agent-probe.mjs";

const REGISTRY = {
	opencode: {
		id: "opencode",
		channel: { npm: "opencode-ai" },
		nextChannel: { npm: "@opencode/cli" },
	},
	"claude-code": {
		id: "claude-code",
		adapterPackage: "@agentclientprotocol/claude-agent-acp",
		channel: { npm: "@anthropic-ai/claude-code" },
	},
	deepagents: {
		id: "deepagents",
		channel: { uv: ["deepagents-code", "deepagents-acp"] },
	},
	local: { id: "local" },
};

test("the probe declares no binary, argv or install command of its own (#1013)", () => {
	const source = readFileSync(
		new URL("./agent-probe.mjs", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /\b(bin|args|npm|pip):\s*[["]/);
	assert.match(source, /host\.detectAgent\(/);
	assert.match(source, /host\.planLaunch\(/);
	assert.match(source, /host\.probeAgent\(/);
	assert.match(source, /adapters\.shippedAdapter\(/);
});

test("rows run at the channel's latest and pin, the next major's latest, and the shipped adapter", () => {
	const latest = {
		"opencode-ai": "1.19.5",
		"@opencode/cli": "2.2.5",
		"@anthropic-ai/claude-code": "2.2.0",
		"deepagents-code": "0.2.2",
	};
	const pins = {
		"opencode-ai": "1.19.5",
		"@anthropic-ai/claude-code": "2.1.312",
		"deepagents-code": "0.2.1",
	};
	const npm = (p) => ({ npm: p });
	assert.deepEqual(plan(REGISTRY, pins, latest), [
		{
			id: "opencode",
			channel: npm("opencode-ai"),
			version: "1.19.5",
			label: "latest, pin",
		},
		{
			id: "opencode",
			channel: npm("@opencode/cli"),
			version: "2.2.5",
			label: "next major, latest",
		},
		{
			id: "claude-code",
			channel: npm("@anthropic-ai/claude-code"),
			adapter: "shipped",
			companion: "2.2.0",
			label: "latest",
		},
		{
			id: "claude-code",
			channel: npm("@anthropic-ai/claude-code"),
			adapter: "shipped",
			companion: "2.1.312",
			label: "pin",
		},
		{
			id: "deepagents",
			channel: REGISTRY.deepagents.channel,
			version: "0.2.2",
			label: "latest",
		},
		{
			id: "deepagents",
			channel: REGISTRY.deepagents.channel,
			version: "0.2.1",
			label: "pin",
		},
	]);
	assert.equal(channelPackage(REGISTRY.deepagents.channel), "deepagents-code");
	assert.equal(
		shown({ adapter: "shipped", companion: "2.2.0" }, "0.98.0"),
		"shipped adapter 0.98.0, cli 2.2.0",
	);
});

test("sign-in-needed counts as started only on a row the probe hands no key", () => {
	const base = {
		agentInfo: { name: "opencode", version: "1.19.5" },
		protocolVersion: 1,
		modes: null,
		detail: null,
	};
	assert.deepEqual(
		["opencode", "claude-code", "codex", "gemini", "deepagents"].filter(
			keyless,
		),
		["opencode", "claude-code"],
	);
	assert.equal(
		verdict({ ...base, outcome: "answers-acp" }, { keyless: false }).ok,
		true,
	);
	assert.equal(
		verdict({ ...base, outcome: "sign-in-needed" }, { keyless: true }).ok,
		true,
	);
	assert.equal(
		verdict({ ...base, outcome: "sign-in-needed" }, { keyless: false }).ok,
		false,
	);
	const flag = verdict(
		{
			...base,
			outcome: "failed-to-start",
			detail: "ERROR Unrecognized flag: --cwd",
		},
		{ keyless: true },
	);
	assert.equal(flag.ok, false);
	assert.match(flag.text, /failed-to-start: ERROR Unrecognized flag/);
});
