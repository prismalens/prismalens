#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One pin bump per agent (#1082 P1). Each agent's pin.json names its CLI and the adapter it
 * moves with; a release becomes a candidate only after it has soaked `minimumReleaseAgeDays`.
 *
 *   agent-bump.mjs matrix                          the agents with a pin, as a JSON array
 *   agent-bump.mjs pick --agent <id>               the candidate as JSON, { agent, cli, adapter }, or null
 *   agent-bump.mjs apply --agent <id> [--cli <v>] [--adapter <v>] [--date <d>]
 *                                                  write the pin, the adapter dependency and tested
 *   agent-bump.mjs package|probe|body --agent <id> its CLI package; the zero-token probe at its pin; its PR body
 *   agent-bump.mjs gate --legs <dir> --digest <d>  verdict=publish only when every OS leg passed this candidate
 *   agent-bump.mjs hold --agent <id> --legs <dir> --run <url>
 *                                                  edit or add the held candidate's comment on the pin-bump issue
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import semver from "semver";
import { agentPins, pinFile, ROOT } from "./agent-pins.mjs";

const DAY = 86_400_000;
const ADAPTERS = "packages/@prismalens/agent-adapters/package.json";

/**
 * The newest stable release older than `days` and newer than `current`, or null. `times` maps a
 * version to its publish time; a version with no time is never picked (a registry that omits it
 * is not evidence of age).
 */
export function pickVersion(times, { current, days, now }) {
	const cutoff = now - days * DAY;
	const soaked = Object.entries(times)
		.filter(
			([v, at]) =>
				semver.valid(v) &&
				!semver.prerelease(v) &&
				at &&
				Date.parse(at) <= cutoff,
		)
		.map(([v]) => v)
		.filter((v) => semver.gt(v, current))
		.sort(semver.rcompare);
	return soaked[0] ?? null;
}

/** npm's `time` map, without its `created` and `modified` keys. */
export function npmTimes(pkg, run = execFileSync) {
	const out = run("npm", ["view", pkg, "time", "--json"], {
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	const { created: _c, modified: _m, ...times } = JSON.parse(out);
	return times;
}

/** PyPI's release times: the earliest upload of each release's files. */
export async function pypiTimes(
	pkg,
	fetchJson = (u) => fetch(u).then((r) => r.json()),
) {
	const { releases } = await fetchJson(`https://pypi.org/pypi/${pkg}/json`);
	return Object.fromEntries(
		Object.entries(releases)
			.filter(([, files]) => files.length && !files.every((f) => f.yanked))
			.map(([v, files]) => [
				v,
				files.map((f) => f.upload_time_iso_8601).sort()[0],
			]),
	);
}

/** The candidate for one agent: a new CLI, a new adapter, or both; null when neither moved. */
export async function pick(pin, { now = Date.now(), timesOf } = {}) {
	const times =
		timesOf ??
		((p, channel) => (channel === "pypi" ? pypiTimes(p) : npmTimes(p)));
	const days = pin.minimumReleaseAgeDays;
	const cli = pickVersion(await times(pin.cli.package, pin.cli.channel), {
		current: pin.cli.version,
		days,
		now,
	});
	const adapter = pin.adapter
		? pickVersion(await times(pin.adapter.package, "npm"), {
				current: pin.adapter.version,
				days,
				now,
			})
		: null;
	return cli || adapter ? { agent: pin.agent, cli, adapter } : null;
}

/** The pin.json and adapter manifest a bump writes; `tested` moves with the pin it proves. */
export function applied(pin, adapters, { cli, adapter, date }) {
	const { agent: _a, minimumReleaseAgeDays, ...file } = pin;
	const next = {
		...file,
		cli: { ...file.cli, ...(cli ? { version: cli } : {}) },
	};
	if (minimumReleaseAgeDays !== 3)
		next.minimumReleaseAgeDays = minimumReleaseAgeDays;
	if (adapter) next.adapter = { ...file.adapter, version: adapter };
	if (file.tested && next.cli.channel === "npm")
		next.tested = next.adapter
			? { version: next.adapter.version, date, companion: next.cli.version }
			: { version: next.cli.version, date };
	const deps = adapter
		? { ...adapters, [next.adapter.package]: adapter }
		: adapters;
	return { pin: next, adapters: deps };
}

/** The OS legs a candidate must pass on before it publishes (A8). */
export const REQUIRED_LEGS = ["ubuntu-latest", "windows-latest"];

/**
 * Publish only when every required leg ran, passed, and tested this same candidate; anything
 * missing or stale holds it, so absent state never publishes.
 */
export function gateVerdict(legs, digest, required = REQUIRED_LEGS) {
	const failing = required.filter((os) => {
		const leg = legs.find((l) => l.os === os);
		return leg?.ok !== true || leg.digest !== digest;
	});
	return { verdict: failing.length ? "hold" : "publish", failing };
}

/** The probe's arguments for a pin: the adapter with its CLI as companion, or the CLI alone. */
export const probeArgs = (pin) =>
	pin.adapter
		? [
				"--agent",
				pin.agent,
				"--version",
				pin.adapter.version,
				"--companion",
				pin.cli.version,
			]
		: ["--agent", pin.agent, "--version", pin.cli.version];

/** What a pin names, for a title or a comment: `claude-code 2.1.330 (adapter 0.109.1)`. */
export const pinName = (pin) =>
	`${pin.agent} ${pin.cli.version}${pin.adapter ? ` (adapter ${pin.adapter.version})` : ""}`;

export const HELD_TITLE = "Agent pin bumps held";
export const heldMarker = (pin) => `<!-- pin-held:${pinName(pin)} -->`;

/** The one comment a held candidate keeps on the pin-bump issue, edited on each repeat. */
export function heldComment(pin, failing, run) {
	return [
		heldMarker(pin),
		`**${pinName(pin)} is held.** It failed conformance on ${failing.join(", ")}, so its pin.json stays where it was and no PR opens.`,
		"",
		`Run: ${run}. The legs' logs name each failing probe fact or matrix row.`,
	].join("\n");
}

/** The pin-bump PR's body: what moved and what proved it. */
export function prBody(pin) {
	return [
		`Moves ${pinName(pin)}: the newest release past its ${pin.minimumReleaseAgeDays}-day soak.`,
		"",
		"Before this PR opened, the candidate passed on Linux and Windows: its locks, an install into a path with a space, the zero-token probe held to the descriptor's facts, and on Linux the admission (R1-R11) and behaviour matrix against the scripted model.",
		"",
		"- [ ] A real-model recording on this pin (#914)",
		"",
		"Docs: none, not on the contract.",
	].join("\n");
}

const readLegs = (dir) =>
	readdirSync(dir)
		.filter((f) => /^leg-.+\.json$/.test(f))
		.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

function gh(args, input) {
	return execFileSync("gh", args, {
		encoding: "utf8",
		input,
		stdio: [input ? "pipe" : "ignore", "pipe", "inherit"],
	});
}

/** Finds or files the held-bumps issue, then edits this candidate's comment or adds it. */
function reportHeld(pin, failing, run) {
	const body = heldComment(pin, failing, run);
	const found = JSON.parse(
		gh([
			"issue",
			"list",
			"--state",
			"open",
			"--search",
			`"${HELD_TITLE}" in:title`,
			"--json",
			"number,title",
		]),
	);
	const issue =
		found.find((i) => i.title === HELD_TITLE)?.number ??
		Number(
			gh([
				"issue",
				"create",
				"--title",
				HELD_TITLE,
				"--body",
				"Each candidate the pin-bump pipeline held, one comment per agent and version (#1082).",
			])
				.trim()
				.split("/")
				.pop(),
		);
	const repo = gh([
		"repo",
		"view",
		"--json",
		"nameWithOwner",
		"--jq",
		".nameWithOwner",
	]).trim();
	const comments = JSON.parse(
		gh(["api", `repos/${repo}/issues/${issue}/comments`, "--paginate"]),
	);
	const mine = comments.find((c) => c.body.startsWith(heldMarker(pin)));
	if (mine)
		gh([
			"api",
			"-X",
			"PATCH",
			`repos/${repo}/issues/comments/${mine.id}`,
			"-f",
			`body=${body}`,
		]);
	else gh(["issue", "comment", String(issue), "--body", body]);
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			agent: { type: "string" },
			cli: { type: "string" },
			adapter: { type: "string" },
			date: { type: "string" },
			legs: { type: "string" },
			digest: { type: "string" },
			run: { type: "string" },
		},
	});
	const [command] = positionals;
	const pins = agentPins();
	if (command === "matrix")
		return console.log(JSON.stringify(pins.map((p) => p.agent)));
	const pin = pins.find((p) => p.agent === values.agent);
	if (!pin) {
		console.error(
			`agent-bump: no pin.json for agent ${values.agent ?? "(none)"}`,
		);
		process.exit(2);
	}
	if (command === "package") return console.log(pin.cli.package);
	if (command === "body") return console.log(prBody(pin));
	if (command === "probe") {
		const r = spawnSync(
			process.execPath,
			[join(ROOT, "scripts/agent-probe.mjs"), ...probeArgs(pin)],
			{ stdio: "inherit" },
		);
		process.exit(r.status ?? 1);
	}
	if (command === "gate") {
		const { verdict, failing } = gateVerdict(
			readLegs(values.legs),
			values.digest,
		);
		console.log(`verdict=${verdict}`);
		console.error(
			verdict === "hold" ? `held: ${failing.join(", ")}` : "every leg passed",
		);
		return;
	}
	if (command === "hold") {
		const { failing } = gateVerdict(readLegs(values.legs), null);
		return reportHeld(pin, failing, values.run);
	}
	if (command === "pick") return console.log(JSON.stringify(await pick(pin)));
	if (command === "apply") {
		const file = join(ROOT, ADAPTERS);
		const manifest = JSON.parse(readFileSync(file, "utf8"));
		const out = applied(pin, manifest.devDependencies, {
			cli: values.cli,
			adapter: values.adapter,
			date: values.date ?? new Date().toISOString().slice(0, 10),
		});
		writeFileSync(
			join(ROOT, pinFile(pin.agent)),
			`${JSON.stringify(out.pin, null, "\t")}\n`,
		);
		if (values.adapter)
			writeFileSync(
				file,
				`${JSON.stringify({ ...manifest, devDependencies: out.adapters }, null, "\t")}\n`,
			);
		return console.log(
			`agent-bump: ${pin.agent} pinned to ${out.pin.cli.version}`,
		);
	}
	console.error(
		"usage: agent-bump.mjs matrix | package|pick|probe|body --agent <id> | apply --agent <id> --cli <v> [--adapter <v>] | gate --legs <dir> --digest <d> | hold --agent <id> --legs <dir> --run <url>",
	);
	process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
