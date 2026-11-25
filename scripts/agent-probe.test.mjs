// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	channelPackage,
	factsFor,
	keyless,
	PROBE_FILES,
	plan,
	run,
	shown,
	uvInstallArgs,
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
		"deepagents-code": "0.1.9",
	};
	const npm = (p) => ({ npm: p });
	assert.deepEqual(plan(REGISTRY, pins, latest), [
		{
			id: "opencode",
			channel: npm("opencode-ai"),
			version: "1.19.5",
			label: "latest",
		},
		{
			id: "opencode",
			channel: npm("opencode-ai"),
			version: "1.19.5",
			label: "pin",
		},
		{
			id: "opencode",
			channel: npm("@opencode/cli"),
			version: "2.2.5",
			label: "next major, latest",
			next: true,
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
			version: "0.1.9",
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

test("an agent that answers another protocol major is held, with the protocol line (class U)", () => {
	const answer = (protocolVersion) =>
		verdict(
			{
				outcome: "answers-acp",
				protocolVersion,
				agentInfo: { name: "fake", version: "9.9.9" },
				modes: null,
				detail: null,
			},
			{ keyless: false, protocol: 1 },
		);
	assert.deepEqual(answer(2), {
		ok: false,
		text: "answers ACP (protocol 2, fake 9.9.9; 0 modes); agent speaks protocol 2; client speaks 1",
	});
	assert.deepEqual(answer(1), {
		ok: true,
		text: "answers ACP (protocol 1, fake 9.9.9; 0 modes)",
	});
});

test("a probed fact the initialize answer contradicts turns an answering agent red, and says which", () => {
	const answered = {
		agentInfo: { name: "gemini", version: "0.60.0" },
		protocolVersion: 1,
		modes: null,
		detail: null,
		outcome: "answers-acp",
		raw: { initialize: { agentCapabilities: {} } },
	};
	assert.deepEqual(verdict(answered, { keyless: false, mismatches: [] }), {
		ok: true,
		text: "answers ACP (protocol 1, gemini 0.60.0; 0 modes); facts hold",
	});
	assert.deepEqual(
		verdict(answered, {
			keyless: false,
			mismatches: ["images: registry true, agent false"],
		}),
		{
			ok: false,
			text: "answers ACP (protocol 1, gemini 0.60.0; 0 modes); facts differ: images: registry true, agent false",
		},
	);
});

test("the next major is held to its own recorded differences, the pin and latest to the row's facts (#1173)", () => {
	const fact = (value) => ({
		value,
		via: "probe",
		verifiedAt: { cli: "1.19.5", adapter: null },
	});
	const row = {
		facts: { directories: fact(false), images: fact(true) },
		nextFacts: { directories: true },
	};
	assert.equal(factsFor(row, { label: "pin" }), row.facts);
	assert.deepEqual(factsFor(row, { next: true }), {
		directories: fact(true),
		images: fact(true),
	});
	assert.equal(factsFor({ facts: row.facts }, { next: true }), row.facts);
});

test("the deepagents profile names a default model, which deepagents-code 0.2.4 needs to start (#1035)", () => {
	assert.match(
		PROBE_FILES.deepagents["config.toml"],
		/^\[models\]\ndefault = "[a-z]+:[^"]+"\n$/,
	);
});

test("native process arguments keep requirement operators literal on Windows", () => {
	assert.equal(
		run(process.execPath, [
			"-p",
			"process.argv[1]",
			"agent-client-protocol<1",
		]).trim(),
		"agent-client-protocol<1",
	);
});

test("a probe at the pinned Deep Agents version installs under the ACP cap its channel leaves off, whatever its label (#1204)", () => {
	const channel = { uv: ["deepagents-code", "extra-pkg"] };
	const pins = { "deepagents-code": "0.1.9" };
	const args = (version, label) =>
		uvInstallArgs({ channel, version, label }, "py", pins);
	const capped = [
		"pip",
		"install",
		"--quiet",
		"--python",
		"py",
		"deepagents-code==0.1.9",
		"extra-pkg",
		"agent-client-protocol<1",
	];
	assert.deepEqual(args("0.1.9", "pin"), capped);
	assert.deepEqual(args("0.1.9", "latest, pin"), capped);
	assert.deepEqual(args("0.2.2", "latest"), [
		"pip",
		"install",
		"--quiet",
		"--python",
		"py",
		"deepagents-code==0.2.2",
		"extra-pkg",
	]);
	assert.deepEqual(
		uvInstallArgs(
			{ channel, version: "0.2.2", label: "latest, pin" },
			"py",
			{},
		),
		[
			"pip",
			"install",
			"--quiet",
			"--python",
			"py",
			"deepagents-code==0.2.2",
			"extra-pkg",
		],
	);
});
