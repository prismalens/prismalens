// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	admissionLegs,
	applied,
	gateVerdict,
	heldComment,
	moves,
	pick,
	pickVersion,
	probeArgs,
	pypiTimes,
} from "./agent-bump.mjs";
import { agentPins } from "./agent-pins.mjs";

const NOW = Date.parse("2026-11-25T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

test("pickVersion takes the newest stable release past its soak, never a prerelease or a fresh one", () => {
	const times = {
		"1.0.0": daysAgo(30),
		"1.1.0": daysAgo(10),
		"1.2.0": daysAgo(4),
		"1.3.0-beta.1": daysAgo(9),
		"1.3.0": daysAgo(1),
	};
	assert.equal(
		pickVersion(times, { current: "1.0.0", days: 3, now: NOW }),
		"1.2.0",
	);
	assert.equal(
		pickVersion(times, { current: "1.2.0", days: 3, now: NOW }),
		null,
	);
	assert.equal(
		pickVersion(times, { current: "1.0.0", days: 7, now: NOW }),
		"1.1.0",
	);
});

test("pickVersion never picks a release whose publish time is missing", () => {
	assert.equal(
		pickVersion(
			{ "2.0.0": undefined },
			{ current: "1.0.0", days: 3, now: NOW },
		),
		null,
	);
});

test("pypiTimes dates a release by its first upload and drops yanked and empty releases", async () => {
	const times = await pypiTimes("acme", async (url) => {
		assert.equal(url, "https://pypi.org/pypi/acme/json");
		return {
			releases: {
				"0.1.0": [
					{ upload_time_iso_8601: "2026-01-02T00:00:00Z" },
					{ upload_time_iso_8601: "2026-01-01T00:00:00Z" },
				],
				"0.2.0": [
					{ upload_time_iso_8601: "2026-02-01T00:00:00Z", yanked: true },
				],
				"0.3.0": [],
			},
		};
	});
	assert.deepEqual(times, { "0.1.0": "2026-01-01T00:00:00Z" });
});

const claude = {
	agent: "claude-code",
	cli: {
		package: "@anthropic-ai/claude-code",
		version: "2.0.0",
		channel: "npm",
	},
	adapter: {
		package: "@agentclientprotocol/claude-agent-acp",
		version: "0.9.0",
	},
	tested: { version: "0.9.0", date: "2026-01-01", companion: "2.0.0" },
	minimumReleaseAgeDays: 3,
};

test("pick moves the CLI and its adapter together, each on its own soak, and is null when neither moved", async () => {
	const timesOf = async (pkg) =>
		pkg === claude.cli.package
			? { "2.0.0": daysAgo(40), "2.1.0": daysAgo(5) }
			: { "0.9.0": daysAgo(40), "0.10.0": daysAgo(1) };
	assert.deepEqual(await pick(claude, { now: NOW, timesOf }), {
		agent: "claude-code",
		cli: "2.1.0",
		adapter: null,
	});
	const still = async (pkg) =>
		pkg === claude.cli.package
			? { "2.0.0": daysAgo(40) }
			: { "0.9.0": daysAgo(40) };
	assert.equal(await pick(claude, { now: NOW, timesOf: still }), null);
});

test("apply writes the new pin, the adapter dependency pnpm installs, and the tested pair it proves", () => {
	const out = applied(
		claude,
		{ "@agentclientprotocol/claude-agent-acp": "0.9.0", other: "1.0.0" },
		{
			cli: "2.1.0",
			adapter: "0.10.0",
			date: "2026-11-25",
		},
	);
	assert.deepEqual(out.pin, {
		cli: {
			package: "@anthropic-ai/claude-code",
			version: "2.1.0",
			channel: "npm",
		},
		adapter: {
			package: "@agentclientprotocol/claude-agent-acp",
			version: "0.10.0",
		},
		tested: { version: "0.10.0", date: "2026-11-25", companion: "2.1.0" },
	});
	assert.deepEqual(out.adapters, {
		"@agentclientprotocol/claude-agent-acp": "0.10.0",
		other: "1.0.0",
	});
});

test("apply leaves a Python pin's hand-recorded tested alone", () => {
	const deep = {
		agent: "deepagents",
		cli: { package: "deepagents-code", version: "0.1.0", channel: "pypi" },
		tested: { version: "0.1.5", date: "2026-09-23" },
		minimumReleaseAgeDays: 3,
	};
	assert.deepEqual(
		applied(deep, {}, { cli: "0.3.0", date: "2026-11-25" }).pin,
		{
			cli: { package: "deepagents-code", version: "0.3.0", channel: "pypi" },
			tested: { version: "0.1.5", date: "2026-09-23" },
		},
	);
});

const legs = (digest, okWin = true) => [
	{ os: "ubuntu-latest", digest, ok: true },
	{ os: "windows-latest", digest, ok: okWin },
];

test("each agent's gate reads only its own legs: one failing agent holds, the other publishes (class B)", () => {
	assert.deepEqual(gateVerdict(legs("aaa"), "aaa"), {
		verdict: "publish",
		failing: [],
	});
	assert.deepEqual(gateVerdict(legs("bbb", false), "bbb"), {
		verdict: "hold",
		failing: ["windows-latest"],
	});
});

test("a missing leg, or a leg that tested another candidate, holds the bump", () => {
	assert.deepEqual(
		gateVerdict([{ os: "ubuntu-latest", digest: "aaa", ok: true }], "aaa"),
		{
			verdict: "hold",
			failing: ["windows-latest"],
		},
	);
	assert.deepEqual(gateVerdict(legs("old"), "new"), {
		verdict: "hold",
		failing: ["ubuntu-latest", "windows-latest"],
	});
});

test("the probe runs the adapter with its CLI as companion, or the CLI alone", () => {
	assert.deepEqual(probeArgs(claude), [
		"--agent",
		"claude-code",
		"--version",
		"0.9.0",
		"--companion",
		"2.0.0",
	]);
	assert.deepEqual(probeArgs({ agent: "gemini", cli: { version: "0.60.0" } }), [
		"--agent",
		"gemini",
		"--version",
		"0.60.0",
	]);
});

test("a held candidate's comment carries its marker, so a repeat edits it", () => {
	assert.equal(
		heldComment(claude, ["windows-latest"], "https://example.test/run/1"),
		[
			"<!-- pin-held:claude-code 2.0.0 (adapter 0.9.0) -->",
			"**claude-code 2.0.0 (adapter 0.9.0) is held.** It failed conformance on windows-latest, so its pin.json stays where it was and no PR opens.",
			"",
			"Run: https://example.test/run/1. The legs' logs name each failing probe fact or matrix row.",
		].join("\n"),
	);
});

test("moves lists the CLI and the adapter that changed, as agent-facts reads them", () => {
	const after = {
		...claude,
		cli: { ...claude.cli, version: "2.1.0" },
		adapter: { ...claude.adapter, version: "0.10.0" },
	};
	assert.deepEqual(moves(claude, after), [
		{
			package: "@anthropic-ai/claude-code",
			current: "2.0.0",
			version: "2.1.0",
		},
		{
			package: "@agentclientprotocol/claude-agent-acp",
			current: "0.9.0",
			version: "0.10.0",
		},
	]);
	assert.deepEqual(moves(claude, claude), []);
});

test("proofs.yml gets one qualification leg per pin, with its package, binary and tier", () => {
	const pins = [
		{ agent: "a", cli: { package: "@x/a", bin: "a-cli" }, tier: 1 },
		{ agent: "b", cli: { package: "b-py", bin: "bb" }, tier: 2 },
	];
	assert.deepEqual(admissionLegs(pins), [
		{ harness: "a", pin: "@x/a", binary: "a-cli", tier: 1 },
		{ harness: "b", pin: "b-py", binary: "bb", tier: 2 },
	]);
	assert.deepEqual(
		admissionLegs(agentPins()).map((l) => [l.harness, l.tier]),
		[
			["claude-code", 1],
			["codex", 1],
			["deepagents", 2],
			["gemini", 2],
			["opencode", 1],
		],
	);
});
