// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// mirror-release.yml's retention steps, run as bash with `aws` stubbed: one group for the whole
// bucket, stable tags only, and a size check before the first write (#1215).
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

const mirror = parse(
	readFileSync(
		new URL("../.github/workflows/mirror-release.yml", import.meta.url),
		"utf8",
	),
);
const step = (name) => {
	const found = mirror.jobs.mirror.steps.find((s) => s.name === name);
	assert.ok(found, `no step named ${name}`);
	return found;
};

/** Runs a step's script in a scratch dir; `aws` prints `listing` and logs every call. */
function run(name, { env, listing = "", assets = {} }) {
	const dir = mkdtempSync(join(tmpdir(), "pl-mirror-"));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const calls = join(dir, "aws.log");
	writeFileSync(calls, "");
	writeFileSync(
		join(bin, "aws"),
		`#!/usr/bin/env bash\necho "$*" >> "${calls.replaceAll("\\", "/")}"\ncat <<'LISTING'\n${listing}\nLISTING\n`,
	);
	chmodSync(join(bin, "aws"), 0o755);
	mkdirSync(join(dir, "assets"));
	for (const [file, bytes] of Object.entries(assets))
		writeFileSync(join(dir, "assets", file), "x".repeat(bytes));
	const r = spawnSync("bash", ["-e", "-c", step(name).run], {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			BUCKET: "bucket",
			ENDPOINT: "https://r2.example",
			CEILING_BYTES: "5000",
			...env,
			PATH: `${bin}${delimiter}${process.env.PATH}`,
		},
	});
	return {
		status: r.status,
		stdout: r.stdout,
		calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean),
	};
}

const row = (key, bytes) =>
	`2026-11-24 10:00:00 ${String(bytes).padStart(10)} ${key}`;

test("every tag's job shares one concurrency group and none is cancelled", () => {
	assert.deepEqual(mirror.concurrency, {
		group: "mirror-prismalens-releases",
		"cancel-in-progress": false,
	});
});

for (const tag of [
	"v0.5.7-nightly.20261117.3",
	"v0.5.7-rc.1",
	"0.5.7",
	"v0.5",
	"v0.5.7 ",
]) {
	test(`${JSON.stringify(tag)} is refused before the bucket is read or written`, () => {
		const r = run("Only stable release tags are mirrored", {
			env: { TAG: tag },
		});
		assert.equal(r.status, 1);
		assert.equal(
			r.stdout,
			`::error::${tag} is not a stable release tag (vX.Y.Z); nothing was written\n`,
		);
		assert.deepEqual(r.calls, []);
	});
}

test("a stable tag passes the tag check", () => {
	const r = run("Only stable release tags are mirrored", {
		env: { TAG: "v0.5.7" },
	});
	assert.equal(r.status, 0);
	assert.deepEqual(r.calls, []);
});

// The kept versions hold 1000 + 1500 bytes; v0.5.1 is dropped; v0.5.7's old copy is replaced.
const bucket = [
	row("v0.5.1/a.tar.gz", 900),
	row("v0.5.4/a.tar.gz", 1000),
	row("v0.5.5/a.tar.gz", 1000),
	row("v0.5.5/SHA256SUMS", 500),
	row("v0.5.7/a.tar.gz", 700),
].join("\n");
const room = (incoming, ceiling) =>
	run("The bucket has room for this release", {
		env: { TAG: "v0.5.7", DROP: "v0.5.1 ", CEILING_BYTES: String(ceiling) },
		listing: bucket,
		assets: { "a.tar.gz": incoming - 100, SHA256SUMS: 100 },
	});

test("a release that fits beside the kept versions passes, counting neither the dropped nor its own old copy", () => {
	const r = room(2000, 4500);
	assert.equal(r.status, 0);
	assert.equal(
		r.stdout,
		"Bucket keeps 2500 bytes and takes 2000 more (ceiling 4500)\n",
	);
});

test("a release that would pass the ceiling is refused before any write", () => {
	const r = room(2000, 4499);
	assert.equal(r.status, 1);
	assert.equal(
		r.stdout,
		"Bucket keeps 2500 bytes and takes 2000 more (ceiling 4499)\n::error::Mirroring v0.5.7 would hold 4500 bytes, over the 4499 ceiling; nothing was written\n",
	);
	assert.deepEqual(r.calls, [
		"s3 ls s3://bucket/ --recursive --endpoint-url https://r2.example",
	]);
});
