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
	const step = jobs.report.steps.find((s) => s.id === "night");
	for (const job of live) {
		assert.ok(jobs.report.needs.includes(job), `report.needs lacks ${job}`);
		assert.ok(
			step.env.LIVE.includes(`needs.${job}.result`),
			`LIVE lacks ${job}`,
		);
	}
	// The pack job failed, its dependant was skipped, the rest passed: the issue is not closed.
	const dir = mkdtempSync(join(tmpdir(), "pl-report-"));
	const run = (liveResults) =>
		runStep(
			step,
			{
				PROOFS: "success",
				PUBLISH: "skipped",
				LIVE: liveResults,
				RUNNER_TEMP: dir,
				REPO: "prismalens/prismalens",
				RUN_URL: "u",
				RUN_ID: "1",
			},
			{ gh: "true" },
		).out;
	assert.match(run("failure skipped success"), /^ok=false$/m);
	assert.match(run("success success success"), /^ok=true$/m);
});

test("a night with NIGHTLY_ENABLED unset says it was skipped and touches no issue", () => {
	const { jobs } = workflow("nightly.yml");
	const gate = jobs.report.steps.find((s) => s.id === "gate");
	const dir = mkdtempSync(join(tmpdir(), "pl-gate-"));
	const summary = join(dir, "summary.md");
	const env = { EVENT: "schedule", GITHUB_STEP_SUMMARY: summary };
	const unset = runStep(gate, { ...env, ENABLED: "" });
	assert.match(unset.out, /^skipped=true$/m);
	assert.match(readFileSync(summary, "utf8"), /NIGHTLY_ENABLED is "unset"/);
	assert.doesNotMatch(
		runStep(gate, { ...env, ENABLED: "true" }).out,
		/skipped/,
	);
	assert.doesNotMatch(
		runStep(gate, { ...env, EVENT: "workflow_dispatch", ENABLED: "" }).out,
		/skipped/,
	);
	assert.equal(jobs.report.if, "always()");
	const reporter = jobs.report.steps.find(
		(s) => s.uses === "./.github/actions/report-failure",
	);
	assert.equal(reporter.if, "steps.gate.outputs.skipped != 'true'");
});

test("the e2e job holds issues: write for its quarantine reporter, which a called workflow cannot get from its caller alone", () => {
	const e2e = workflow("e2e-browser.yml").jobs.e2e;
	assert.deepEqual(e2e.permissions, { contents: "read", issues: "write" });
	assert.equal(
		e2e.steps.some((s) => s.uses === "./.github/actions/report-failure"),
		true,
	);
	assert.deepEqual(workflow("ci.yml").jobs.e2e.permissions, {
		contents: "read",
		issues: "write",
	});
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
			{ LATEST: latest, VERSION: version, TARBALL: "launcher/pl.tgz" },
			{ npm: `echo "${npmLatest}"`, node: 'echo "$@"' },
		).stdout.trim();
	const publish =
		"scripts/pack-launcher.mjs --publish --tarball launcher/pl.tgz";
	assert.equal(tag("0.5.7", "true", "0.5.6"), `${publish} --tag previous`);
	assert.equal(tag("0.5.5", "true", "0.5.6"), `${publish} --tag latest`);
	assert.equal(tag("0.5.5", "false", "0.5.6"), `${publish} --tag previous`);
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

/** Every job `job` waits on, directly or through others. */
function ancestors(jobs, job, seen = new Set()) {
	for (const need of [jobs[job].needs ?? []].flat()) {
		if (seen.has(need)) continue;
		seen.add(need);
		ancestors(jobs, need, seen);
	}
	return seen;
}

const PROOFS = ["upgrade-chain", "release-side-checks"];
const runs = (job) => (job.steps ?? []).map((s) => String(s.run ?? ""));

for (const proof of PROOFS)
	test(`the ${proof} proof runs before publish-release, on the draft's own assets (#1154)`, () => {
		const { jobs } = workflow("release.yml");
		const before = ancestors(jobs, proof);
		assert.equal(before.has("publish-release"), false);
		assert.equal(before.has("sums"), true);
		const download = jobs[proof].steps.filter((s) =>
			String(s.run).includes('gh release download "$TAG"'),
		);
		assert.equal(download.length > 0, true);
		assert.deepEqual(
			download.map((step) => step.env.GH_TOKEN),
			download.map(() => "${{ github.token }}"),
		);
		assert.deepEqual(
			jobs[proof].steps.filter((step) =>
				JSON.stringify(step).includes("PACKED_CHAIN_RELEASE_BASE"),
			),
			[],
		);
	});

test("the upgrade chain and the side checks each run the launcher and archive of the draft (#1154)", () => {
	const { jobs } = workflow("release.yml");
	assert.equal(
		jobs["upgrade-chain"].steps.at(-1).run,
		'node scripts/packed-upgrade-chain.mjs --assets assets --launcher "$(ls launcher/prismalens-*.tgz)"',
	);
	const sideChecks = jobs["release-side-checks"];
	assert.deepEqual(
		sideChecks.strategy.matrix.include.map((m) => [m.os, m.target]),
		[
			["ubuntu-latest", "linux-x64"],
			["macos-latest", "darwin-arm64"],
			["windows-latest", "win32-x64"],
		],
	);
	assert.ok(
		sideChecks.steps
			.at(-1)
			.run.includes(
				'node scripts/gate-side-checks.mjs --no-skip --archive "$(ls assets/prismalens-*-"$TARGET".*)" --launcher "$(ls launcher/prismalens-*.tgz)"',
			),
	);
});

for (const job of ["publish-release", "npm"])
	test(`${job} waits on every release proof (#1154)`, () => {
		const { jobs } = workflow("release.yml");
		assert.deepEqual(
			PROOFS.filter((proof) => [jobs[job].needs].flat().includes(proof)),
			PROOFS,
		);
	});

test("npm waits on publish-release, so the release is public before npm has the launcher (#1154)", () => {
	const { jobs } = workflow("release.yml");
	assert.equal(ancestors(jobs, "npm").has("publish-release"), true);
});

test("a release builds each artifact once: no job after the build stage rebuilds one (#1154)", () => {
	const { jobs } = workflow("release.yml");
	const rebuilds = Object.keys(jobs).filter((name) =>
		runs(jobs[name]).some((r) =>
			/pack-cli|build-standalone|\bpnpm (run )?(build|pack)\b/.test(r),
		),
	);
	assert.deepEqual(rebuilds, []);
	const packsLauncher = Object.keys(jobs).filter((name) =>
		runs(jobs[name]).some(
			(r) => /pack-launcher.mjs/.test(r) && !r.includes("--tarball"),
		),
	);
	assert.deepEqual(packsLauncher, ["launcher"]);
	const upload = jobs.launcher.steps.find((s) =>
		String(s.uses).startsWith("actions/upload-artifact@"),
	);
	assert.equal(upload.with.name, "release-launcher");
});

for (const user of [...PROOFS, "npm"])
	test(`${user} installs the launcher artifact that the launcher job packed once (#1154)`, () => {
		const { jobs } = workflow("release.yml");
		const download = jobs[user].steps.find((s) =>
			String(s.uses).startsWith("actions/download-artifact@"),
		);
		assert.equal(download.with.name, "release-launcher");
		assert.equal(ancestors(jobs, user).has("launcher"), true);
	});

test("npm publishes the launcher the proofs ran, as packed", () => {
	const { jobs } = workflow("release.yml");
	const publish = jobs.npm.steps.find((s) =>
		String(s.run).includes("pack-launcher.mjs --publish"),
	);
	assert.ok(
		publish.run
			.trim()
			.endsWith(
				'node scripts/pack-launcher.mjs --publish --tarball "$TARBALL" --tag "$tag"',
			),
	);
	assert.equal(
		publish.env.TARBALL,
		"launcher/prismalens-${{ needs.draft.outputs.version }}.tgz",
	);
	assert.equal(publish.env.GH_TOKEN, "");
});

// Which failures count as never started or a network fault is `ci-gate-report.test.mjs`'s.
test("the rerun workflow watches the Nightly as it watches CI, for a failed first attempt only, and rerun-mode is on (#1085)", () => {
	const { on, jobs } = workflow("ci-rerun-unstarted.yml");
	assert.deepEqual(on.workflow_run.workflows, [
		"CI",
		"Standalone CLI build",
		"Nightly",
	]);
	assert.equal(workflow("nightly.yml").name, "Nightly");
	assert.equal(
		jobs.rerun.if,
		"github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.run_attempt == 1",
	);
	assert.equal(
		jobs.rerun.steps.find((s) => s.run === "node scripts/ci-gate-report.mjs")
			.env.RERUN,
		"1",
	);
});

test("the lint job may read the issues its quarantine check looks up (#1154)", () => {
	assert.deepEqual(workflow("ci.yml").jobs.lint.permissions, {
		contents: "read",
		issues: "read",
	});
});
