// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The release and nightly workflows' decision scripts, run as bash with gh, npm and node
// stubbed: what a cancelled nightly stage reports, which release takes `latest`, and that two
// overlapping releases never hand npm's `latest` back to the older one (#717).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = (name) =>
	parse(
		readFileSync(
			new URL(`../.github/workflows/${name}`, import.meta.url),
			"utf8",
		),
	);

/** Runs one step's script with `env` and stub commands; returns its GITHUB_OUTPUT and stdout. */
function runStep(step, env, stubs = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pl-step-"));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	for (const [name, script] of Object.entries(stubs)) {
		writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${script}\n`);
		chmodSync(join(bin, name), 0o755);
	}
	const output = join(dir, "output");
	writeFileSync(output, "");
	const r = spawnSync("bash", ["-e", "-c", step.run], {
		encoding: "utf8",
		env: {
			...process.env,
			...env,
			GITHUB_OUTPUT: output,
			GITHUB_REPOSITORY: "prismalens/prismalens",
			PATH: `${bin}${delimiter}${process.env.PATH}`,
		},
	});
	assert.equal(r.status, 0, r.stderr);
	return { out: readFileSync(output, "utf8"), stdout: r.stdout };
}

test("a cancelled or failed nightly stage is the publish result the tracking issue reads", () => {
	const step = workflow("nightly.yml").jobs.report.steps.find(
		(s) => s.id === "publication",
	);
	const result = (stages, publish) =>
		runStep(step, { STAGES: stages, PUBLISH: publish }).out.trim();
	assert.equal(
		result("success cancelled skipped", "skipped"),
		"result=cancelled",
	);
	assert.equal(result("success success failure", "skipped"), "result=failure");
	assert.equal(
		result("cancelled failure skipped", "skipped"),
		"result=cancelled",
	);
	assert.equal(result("success success success", "success"), "result=success");
	assert.equal(result("skipped skipped skipped", "skipped"), "result=skipped");
});

// A failed `live-pack` skips `packed-intake-live`; `report` must still see the failure (#1197 review).
test("the tracking issue waits on every live job and stays open when one failed", () => {
	const { jobs } = workflow("nightly.yml");
	const live = Object.keys(jobs).filter((k) =>
		String(jobs[k].name).startsWith("Live:"),
	);
	assert.deepEqual(live.sort(), [
		"harness-admission-live",
		"live-pack",
		"packed-intake-live",
	]);
	const step = jobs.report.steps.find((s) =>
		s.name?.startsWith("Open, update"),
	);
	for (const job of live) {
		assert.ok(jobs.report.needs.includes(job), `report.needs lacks ${job}`);
		assert.ok(
			step.env.LIVE.includes(`needs.${job}.result`),
			`LIVE lacks ${job}`,
		);
	}
	// The pack job failed, its dependant was skipped, the rest passed: the issue is not closed.
	const dir = mkdtempSync(join(tmpdir(), "pl-report-"));
	const log = join(dir, "gh.log");
	const run = (liveResults) =>
		runStep(
			step,
			{
				PROOFS: "success",
				PUBLISH: "skipped",
				LIVE: liveResults,
				DRY_RUN: "false",
				RUNNER_TEMP: dir,
				REPO: "prismalens/prismalens",
				RUN_URL: "u",
				RUN_ID: "1",
			},
			{
				gh: `echo "$@" >> "${log}"; case "$1 $2" in "issue list") echo '[{"number":7,"title":"Nightly CI failing","state":"OPEN"}]';; "api repos/prismalens/prismalens/actions/runs/1/jobs") ;; esac`,
			},
		);
	run("failure skipped success");
	const red = readFileSync(log, "utf8");
	assert.ok(!red.includes("issue close"), red);
	assert.ok(red.includes("issue edit 7"), red);
	writeFileSync(log, "");
	run("success success success");
	assert.ok(readFileSync(log, "utf8").includes("issue close 7"));
});

test("a release takes `latest` only if it is the newest when it is promoted", () => {
	const step = workflow("release.yml").jobs["publish-release"].steps.find(
		(s) => s.id === "latest",
	);
	const latest = (current, version) =>
		runStep(
			step,
			{ VERSION: version, GH_TOKEN: "x" },
			{ gh: `echo "${current}"` },
		).out.trim();
	assert.equal(latest("v0.5.7", "0.5.6"), "latest=false");
	assert.equal(latest("v0.5.6", "0.5.7"), "latest=true");
	assert.equal(latest("", "0.5.7"), "latest=true");
});

test("npm's dist-tag is `previous` when npm already has a newer latest", () => {
	const step = workflow("release.yml").jobs.npm.steps.find((s) =>
		String(s.run).includes("pack-launcher.mjs --publish"),
	);
	const tag = (npmLatest, latest, version) =>
		runStep(
			step,
			{ LATEST: latest, VERSION: version },
			{ npm: `echo "${npmLatest}"`, node: 'echo "$@"' },
		).stdout.trim();
	assert.equal(
		tag("0.5.7", "true", "0.5.6"),
		"scripts/pack-launcher.mjs --publish --tag previous",
	);
	assert.equal(
		tag("0.5.5", "true", "0.5.6"),
		"scripts/pack-launcher.mjs --publish --tag latest",
	);
	assert.equal(
		tag("0.5.5", "false", "0.5.6"),
		"scripts/pack-launcher.mjs --publish --tag previous",
	);
});

/** Runs `step` as bash with `env` and the stub commands in `bin`; resolves to its exit status. */
const runBash = (step, env, bin) =>
	new Promise((done) => {
		const child = spawn("bash", ["-e", "-c", step.run], {
			stdio: ["ignore", "ignore", "inherit"],
			env: {
				...process.env,
				...env,
				PATH: `${bin}${delimiter}${process.env.PATH}`,
			},
		});
		child.on("exit", done);
	});

test("two overlapping releases leave npm's latest on the newer one", async () => {
	const job = workflow("release.yml").jobs.npm;
	// GitHub queues jobs whose concurrency group is the same; others run at once.
	const group = (ref) =>
		job.concurrency &&
		String(job.concurrency.group ?? job.concurrency).replaceAll(
			"${{ github.ref }}",
			ref,
		);
	const queued =
		Boolean(group("refs/heads/main")) &&
		group("refs/heads/main") === group("refs/heads/release-0.5.6");
	const step = job.steps.find((s) =>
		String(s.run).includes("pack-launcher.mjs --publish"),
	);
	const bin = mkdtempSync(join(tmpdir(), "pl-npm-"));
	// Running at once, the worst order: both read npm's `latest`, then 0.5.7 publishes first.
	const stubs = {
		npm: 'cat "$STATE/latest"; touch "$STATE/read-$VERSION"; [ -z "$RACE" ] || until [ -e "$STATE/read-$OTHER" ]; do sleep 0.05; done',
		node: '[ -z "$RACE" ] || [ "$VERSION" != 0.5.6 ] || until [ -e "$STATE/published-$OTHER" ]; do sleep 0.05; done\ncase "$*" in *"--tag latest"*) echo "$VERSION" > "$STATE/latest" ;; esac\ntouch "$STATE/published-$VERSION"',
	};
	for (const [name, script] of Object.entries(stubs)) {
		writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${script}\n`);
		chmodSync(join(bin, name), 0o755);
	}
	const run = (state, version, other, race) =>
		runBash(
			step,
			{
				STATE: state,
				VERSION: version,
				OTHER: other,
				LATEST: "true",
				RACE: race,
			},
			bin,
		);
	const orders = queued
		? [
				["0.5.6", "0.5.7"],
				["0.5.7", "0.5.6"],
			]
		: [null];
	for (const order of orders) {
		const state = mkdtempSync(join(tmpdir(), "pl-npm-state-"));
		writeFileSync(join(state, "latest"), "0.5.5\n");
		if (order)
			for (const v of order)
				assert.equal(
					await run(state, v, v === "0.5.6" ? "0.5.7" : "0.5.6", ""),
					0,
				);
		else
			assert.deepEqual(
				await Promise.all([
					run(state, "0.5.6", "0.5.7", "1"),
					run(state, "0.5.7", "0.5.6", "1"),
				]),
				[0, 0],
			);
		assert.equal(
			readFileSync(join(state, "latest"), "utf8").trim(),
			"0.5.7",
			`npm's latest went back to an older release (${order ? `in turn, ${order.join(" then ")}` : "at once"})`,
		);
	}
});
