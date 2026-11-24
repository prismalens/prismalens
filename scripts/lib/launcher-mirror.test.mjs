// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	archiveFile,
	fakeArchive,
	mergeSums,
	mirrorPublished,
	nightlyAfter,
	ownTarget,
	publishToMirror,
	runtimeAppDir,
} from "./launcher-mirror.mjs";

const work = mkdtempSync(join(tmpdir(), "pl-mirror-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

test("archive names follow build-standalone.mjs per target", () => {
	assert.equal(
		archiveFile("0.5.6", "linux-x64"),
		"prismalens-0.5.6-linux-x64.tar.gz",
	);
	assert.equal(
		archiveFile("0.5.6", "win32-x64"),
		"prismalens-0.5.6-win32-x64.zip",
	);
	assert.equal(ownTarget("darwin", "arm64"), "darwin-arm64");
});

test("a nightly after a stable is the next patch's prerelease", () => {
	assert.equal(nightlyAfter("0.5.6"), "0.5.7-nightly.20261117.1");
	assert.equal(
		nightlyAfter("0.5.6-nightly.1.1", "20270101"),
		"0.5.7-nightly.20270101.1",
	);
});

test("SHA256SUMS keeps one line per name, sorted, and a rewrite replaces it", () => {
	const a = "a".repeat(64);
	const b = "b".repeat(64);
	let sums = mergeSums("", "z.tar.gz", a);
	sums = mergeSums(sums, "y.zip", b);
	sums = mergeSums(sums, "z.tar.gz", b);
	assert.equal(sums, `${b}  y.zip\n${b}  z.tar.gz\n`);
});

test("a fake archive lands in the mirror with its true digest", () => {
	const archive = fakeArchive({
		version: "9.9.9",
		app: 'console.log("9.9.9");\n',
		outDir: work,
	});
	const root = join(work, "mirror");
	publishToMirror(root, archive, "9.9.9");
	const name = archiveFile("9.9.9");
	const digest = createHash("sha256")
		.update(readFileSync(join(root, "v9.9.9", name)))
		.digest("hex");
	assert.equal(
		readFileSync(join(root, "v9.9.9", "SHA256SUMS"), "utf8"),
		`${digest}  ${name}\n`,
	);
});

test("the runtime of a version is found by its app's package.json, and only one may match", () => {
	const dir = join(work, "cache");
	for (const [entry, version] of [
		["0.5.6-x", "0.5.6"],
		["0.5.7-x", "0.5.7-nightly.20261117.1"],
	]) {
		mkdirSync(join(dir, entry, "app"), { recursive: true });
		writeFileSync(
			join(dir, entry, "app", "package.json"),
			JSON.stringify({ name: "prismalens", version }),
		);
	}
	assert.equal(runtimeAppDir(dir, "0.5.6"), join(dir, "0.5.6-x", "app"));
	assert.throws(() => runtimeAppDir(dir, "0.5.5"), /0 runtimes of 0\.5\.5/);
});

const served =
	(body, status = 200) =>
	async (url) => {
		served.last = url;
		return new Response(body, { status });
	};

test("a published release's archive lands in the mirror only with the digest its launcher pins", async () => {
	const root = join(work, "published-mirror");
	mkdirSync(root, { recursive: true });
	const bytes = Buffer.from("release archive bytes");
	const digest = createHash("sha256").update(bytes).digest("hex");
	await mirrorPublished(
		root,
		{ version: "0.5.6", sha256: { "linux-x64": digest } },
		{
			base: "https://releases.test",
			fetchImpl: served(bytes),
			target: "linux-x64",
		},
	);
	assert.equal(
		served.last,
		"https://releases.test/v0.5.6/prismalens-0.5.6-linux-x64.tar.gz",
	);
	assert.deepEqual(
		readFileSync(join(root, "v0.5.6", "prismalens-0.5.6-linux-x64.tar.gz")),
		bytes,
	);
	assert.equal(
		readFileSync(join(root, "v0.5.6", "SHA256SUMS"), "utf8"),
		`${digest}  prismalens-0.5.6-linux-x64.tar.gz\n`,
	);
});

test("a published archive whose digest differs from the pin is refused, and a missing one names its status", async () => {
	const root = join(work, "refused-mirror");
	mkdirSync(root, { recursive: true });
	const pin = "0".repeat(64);
	const bytes = Buffer.from("other bytes");
	const digest = createHash("sha256").update(bytes).digest("hex");
	const opts = { base: "https://releases.test", target: "linux-x64" };
	await assert.rejects(
		mirrorPublished(
			root,
			{ version: "0.5.6", sha256: { "linux-x64": pin } },
			{ ...opts, fetchImpl: served(bytes) },
		),
		{
			message: `https://releases.test/v0.5.6/prismalens-0.5.6-linux-x64.tar.gz has sha256 ${digest}; the launcher pins ${pin}`,
		},
	);
	await assert.rejects(
		mirrorPublished(
			root,
			{ version: "0.5.6", sha256: { "linux-x64": pin } },
			{ ...opts, fetchImpl: served("", 404) },
		),
		{
			message:
				"https://releases.test/v0.5.6/prismalens-0.5.6-linux-x64.tar.gz answered 404",
		},
	);
	await assert.rejects(
		mirrorPublished(root, { version: "0.5.6", sha256: {} }, opts),
		{ message: "prismalens@0.5.6 pins no archive for linux-x64" },
	);
	assert.deepEqual(readdirSync(root), []);
});
