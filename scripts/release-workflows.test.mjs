// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The release and nightly workflows' decision scripts, run as bash with gh, npm and node
// stubbed: what a cancelled nightly stage reports, and which release takes `latest` (#717).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
