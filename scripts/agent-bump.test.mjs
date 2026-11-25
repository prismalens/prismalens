// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import {
	admissionLegs,
	applied,
	gateVerdict,
	HELD_TITLE,
	heldComment,
	moves,
	pick,
	pickVersion,
	prBody,
	probeArgs,
	pypiTimes,
	REQUIRED_LEGS,
	reportHeld,
} from "./agent-bump.mjs";
import { AGENTS_DIR, agentPins, ROOT } from "./agent-pins.mjs";

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
	const asked = [];
	const times = await pypiTimes("acme", async (url) => {
		asked.push(url);
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
	assert.deepEqual(asked, ["https://pypi.org/pypi/acme/json"]);
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

test("the gate publishes when every leg passed, and holds on a failed one", () => {
	assert.deepEqual(gateVerdict(legs("aaa"), "aaa"), {
		verdict: "publish",
		failing: [],
	});
	assert.deepEqual(gateVerdict(legs("bbb", false), "bbb"), {
		verdict: "hold",
		failing: ["windows-latest"],
	});
});

test("each agent's gate reads only its own legs: one failing agent holds, the other publishes (class B)", (t) => {
	const { jobs } = parse(
		readFileSync(join(ROOT, ".github/workflows/agent-bump.yml"), "utf8"),
	);
	const upload = jobs.conformance.steps.find((st) =>
		st.with?.name?.startsWith("leg-"),
	).with.name;
	const { pattern } = jobs.publish.steps.find((st) =>
		st.uses?.startsWith("actions/download-artifact@"),
	).with;
	const named = (text, agent, os = "") =>
		text.replace("${{ inputs.agent }}", agent).replace("${{ matrix.os }}", os);
	// One run's artifacts: every agent's legs share a namespace and the same file names.
	const artifacts = ["codex", "opencode"].flatMap((agent) =>
		REQUIRED_LEGS.map((os) => ({
			name: named(upload, agent, os),
			file: `leg-${os}.json`,
			leg: {
				os,
				digest: "d1",
				ok: !(agent === "codex" && os === "windows-latest"),
			},
		})),
	);
	const gate = (agent) => {
		const dir = mkdtempSync(join(tmpdir(), "agent-bump-legs-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const glob = new RegExp(`^${named(pattern, agent).replaceAll("*", ".*")}$`);
		for (const a of artifacts.filter((a) => glob.test(a.name)))
			writeFileSync(join(dir, a.file), JSON.stringify(a.leg));
		return execFileSync(
			process.execPath,
			[
				join(ROOT, "scripts/agent-bump.mjs"),
				"gate",
				"--legs",
				dir,
				"--digest",
				"d1",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	};
	assert.equal(gate("codex"), "verdict=hold\n");
	assert.equal(gate("opencode"), "verdict=publish\n");
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

test("a held candidate's comment opens with its marker and names the failed legs", () => {
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

test("hold reports the candidate and only its failed leg, and a repeat edits that comment", () => {
	const comments = [];
	const writes = [];
	const api = (args) => {
		const [a, b] = args;
		if (a === "issue" && b === "list")
			return JSON.stringify([{ number: 7, title: HELD_TITLE }]);
		if (a === "repo") return "o/r\n";
		if (a === "api" && b === "repos/o/r/issues/7/comments")
			return JSON.stringify(comments);
		writes.push(args.slice(0, 4));
		if (a === "issue") comments.push({ id: 11, body: args[4] });
		else comments[0].body = args[5].slice("body=".length);
		return "";
	};
	for (const run of ["https://example.test/1", "https://example.test/2"])
		reportHeld(
			claude,
			legs("d1", false),
			{ cli: "2.1.0", adapter: "0.10.0", digest: "d1", run },
			api,
		);
	assert.deepEqual(writes, [
		["issue", "comment", "7", "--body"],
		["api", "-X", "PATCH", "repos/o/r/issues/comments/11"],
	]);
	assert.deepEqual(comments, [
		{
			id: 11,
			body: [
				"<!-- pin-held:claude-code 2.1.0 (adapter 0.10.0) -->",
				"**claude-code 2.1.0 (adapter 0.10.0) is held.** It failed conformance on windows-latest, so its pin.json stays where it was and no PR opens.",
				"",
				"Run: https://example.test/2. The legs' logs name each failing probe fact or matrix row.",
			].join("\n"),
		},
	]);
});

test("the hold step passes the candidate's versions and digest to the report", () => {
	const wf = parse(
		readFileSync(join(ROOT, ".github/workflows/agent-bump.yml"), "utf8"),
	);
	const step = wf.jobs.publish.steps.find(
		(st) => st.name === "Report the held candidate on the pin-bump issue",
	);
	assert.deepEqual(
		[step.env.CLI, step.env.ADAPTER, step.env.DIGEST],
		["cli", "adapter", "digest"].map(
			(k) => `\${{ needs.candidate.outputs.${k} }}`,
		),
	);
	assert.equal(
		step.run,
		'node scripts/agent-bump.mjs hold --agent "$AGENT" ${CLI:+--cli "$CLI"} ${ADAPTER:+--adapter "$ADAPTER"} \\\n  --legs "$RUNNER_TEMP/bump" --digest "$DIGEST" --run "$RUN_URL"\n',
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

test("the commands a job runs before any install need no package", (t) => {
	const bare = mkdtempSync(join(tmpdir(), "agent-bump-bare-"));
	t.after(() => rmSync(bare, { recursive: true, force: true }));
	mkdirSync(join(bare, "scripts"));
	for (const f of [
		"scripts/agent-bump.mjs",
		"scripts/agent-pins.mjs",
		AGENTS_DIR,
	])
		cpSync(join(ROOT, f), join(bare, f), { recursive: true });
	const legsDir = join(bare, "legs");
	mkdirSync(legsDir);
	for (const os of REQUIRED_LEGS)
		writeFileSync(
			join(legsDir, `leg-${os}.json`),
			JSON.stringify({ os, ok: true, digest: "d1" }),
		);
	const run = (...args) =>
		execFileSync(
			process.execPath,
			[join(bare, "scripts/agent-bump.mjs"), ...args],
			{ cwd: bare, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	assert.deepEqual(JSON.parse(run("legs")), admissionLegs(agentPins()));
	assert.deepEqual(
		JSON.parse(run("matrix")),
		agentPins().map((p) => p.agent),
	);
	assert.equal(
		run("gate", "--legs", legsDir, "--digest", "d1"),
		"verdict=publish\n",
	);
	const opencode = agentPins().find((p) => p.agent === "opencode");
	assert.equal(run("body", "--agent", "opencode"), `${prBody(opencode)}\n`);
});

test("proofs.yml fails the legs step when the script fails, never an empty matrix", () => {
	const wf = parse(
		readFileSync(join(ROOT, ".github/workflows/proofs.yml"), "utf8"),
	);
	// An assignment carries the command's exit status; `echo "$(…)"` drops it.
	assert.equal(
		wf.jobs["agent-legs"].steps.find((st) => st.id === "legs").run,
		'legs=$(node scripts/agent-bump.mjs legs)\necho "legs=$legs" >> "$GITHUB_OUTPUT"\n',
	);
});

test("a candidate publishes only past the product's launch path on Linux and a spaced install on Windows (classes L, P)", () => {
	const wf = parse(
		readFileSync(join(ROOT, ".github/workflows/agent-bump.yml"), "utf8"),
	);
	const leg = wf.jobs.conformance;
	assert.deepEqual(leg.strategy.matrix.os, REQUIRED_LEGS);
	const runs = (text) =>
		leg.steps.filter((st) => (st.run ?? "").includes(text));
	// The probe answers initialize alone; the admission launches through the product (#1093).
	assert.deepEqual(
		runs('admission-fake.mjs "$AGENT"').map((st) => st.if),
		["runner.os == 'Linux'"],
	);
	assert.deepEqual(
		runs('--into "$RUNNER_TEMP/dir with space"').map((st) => st.if),
		[undefined],
	);
	// A failed step fails the job, and the job's status is what the gate reads.
	assert.equal(
		leg.steps.find(
			(st) => st.name === "Record this leg's result for the publish gate",
		).env.OK,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template.
		"${{ job.status == 'success' }}",
	);
});
