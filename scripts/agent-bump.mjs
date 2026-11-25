#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One pin bump per agent (#1082 P1). Each agent's pin.json names its CLI and the adapter it
 * moves with; a release becomes a candidate only after it has soaked `minimumReleaseAgeDays`.
 *
 *   agent-bump.mjs matrix                       the agents with a pin, as a JSON array
 *   agent-bump.mjs pick --agent <id>            the candidate, as JSON: { agent, cli, adapter } or null
 *   agent-bump.mjs apply --agent <id> --cli <v> [--adapter <v>] [--date YYYY-MM-DD]
 *                                               write the pin, the adapter dependency and tested
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			agent: { type: "string" },
			cli: { type: "string" },
			adapter: { type: "string" },
			date: { type: "string" },
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
		"usage: agent-bump.mjs matrix | pick --agent <id> | apply --agent <id> --cli <v> [--adapter <v>]",
	);
	process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
