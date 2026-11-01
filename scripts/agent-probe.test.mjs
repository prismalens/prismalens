// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { channelPackage, plan, verdict } from "./agent-probe.mjs";

const REGISTRY = {
	opencode: { id: "opencode", channel: { npm: "opencode-ai" } },
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
});

test("each row runs at its channel's latest, and again at its pin when that is older", () => {
	const latest = {
		"opencode-ai": "2.0.0",
		"@agentclientprotocol/claude-agent-acp": "0.99.0",
		"@anthropic-ai/claude-code": "2.2.0",
		"deepagents-code": "0.2.1",
	};
	const pins = { "opencode-ai": "1.19.5", "deepagents-code": "0.2.1" };
	assert.deepEqual(plan(REGISTRY, pins, latest), [
		{ id: "opencode", version: "2.0.0", label: "latest" },
		{ id: "opencode", version: "1.19.5", label: "pin" },
		{
			id: "claude-code",
			version: "0.99.0",
			companion: "2.2.0",
			label: "latest",
		},
		{ id: "deepagents", version: "0.2.1", label: "latest, pin" },
	]);
	assert.equal(channelPackage(REGISTRY.deepagents.channel), "deepagents-code");
});

test("an agent that answered, or asked for a sign-in, started; anything else fails", () => {
	const base = {
		agentInfo: { name: "opencode", version: "1.19.5" },
		protocolVersion: 1,
		modes: null,
		detail: null,
	};
	assert.equal(verdict({ ...base, outcome: "answers-acp" }).ok, true);
	assert.equal(verdict({ ...base, outcome: "sign-in-needed" }).ok, true);
	const flag = verdict({
		...base,
		outcome: "failed-to-start",
		detail: "ERROR Unrecognized flag: --cwd",
	});
	assert.equal(flag.ok, false);
	assert.match(flag.text, /failed-to-start: ERROR Unrecognized flag/);
	assert.match(
		verdict({
			...base,
			outcome: "no-answer",
			detail: "session/new: no answer in 60s",
		}).text,
		/session\/new/,
	);
});
