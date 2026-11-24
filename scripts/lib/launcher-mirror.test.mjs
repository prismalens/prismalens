// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { packLauncher, publishPacked } from "../pack-launcher.mjs";
import { archiveName, TARGETS } from "../release-complete.mjs";
import {
	archiveFile,
	archiveVersion,
	assertPinnedArchive,
	fakeArchive,
	launcherPins,
	mergeSums,
	mirrorPublished,
	nightlyAfter,
	ownTarget,
	prepareDraftRelease,
	publishToMirror,
	retagArchive,
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

test("a published archive download is tried again after a 5xx or a network error, up to its tries", async () => {
	const root = join(work, "retry-mirror");
	mkdirSync(root, { recursive: true });
	const bytes = Buffer.from("release archive bytes");
	const digest = createHash("sha256").update(bytes).digest("hex");
	const answers = [
		() => Promise.reject(new TypeError("fetch failed")),
		() => Promise.resolve(new Response("", { status: 502 })),
		() => Promise.resolve(new Response(bytes)),
	];
	let calls = 0;
	await mirrorPublished(
		root,
		{ version: "0.5.6", sha256: { "linux-x64": digest } },
		{
			base: "https://releases.test",
			target: "linux-x64",
			fetchImpl: () => answers[calls++](),
		},
	);
	assert.equal(calls, 3);
	assert.deepEqual(
		readFileSync(join(root, "v0.5.6", "prismalens-0.5.6-linux-x64.tar.gz")),
		bytes,
	);
	await assert.rejects(
		mirrorPublished(
			root,
			{ version: "0.5.7", sha256: { "linux-x64": digest } },
			{
				base: "https://releases.test",
				target: "linux-x64",
				tries: 2,
				fetchImpl: async () => new Response("", { status: 503 }),
			},
		),
		{
			message:
				"https://releases.test/v0.5.7/prismalens-0.5.7-linux-x64.tar.gz answered 503",
		},
	);
});

test("a published archive whose body fails mid-download is fetched again, but a changed digest or a 404 is not", async () => {
	const root = join(work, "body-retry-mirror");
	mkdirSync(root, { recursive: true });
	const bytes = Buffer.from("release archive bytes");
	const digest = createHash("sha256").update(bytes).digest("hex");
	const cutOff = () =>
		new Response(
			new ReadableStream({
				start: (c) => c.error(new TypeError("terminated")),
			}),
		);
	const opts = { base: "https://releases.test", target: "linux-x64" };
	let calls = 0;
	const answers = [cutOff, () => new Response(bytes)];
	await mirrorPublished(
		root,
		{ version: "0.5.6", sha256: { "linux-x64": digest } },
		{ ...opts, fetchImpl: async () => answers[calls++]() },
	);
	assert.equal(calls, 2);
	assert.deepEqual(
		readFileSync(join(root, "v0.5.6", "prismalens-0.5.6-linux-x64.tar.gz")),
		bytes,
	);
	calls = 0;
	await assert.rejects(
		mirrorPublished(
			root,
			{ version: "0.5.7", sha256: { "linux-x64": "0".repeat(64) } },
			{
				...opts,
				fetchImpl: async () => {
					calls++;
					return new Response(bytes);
				},
			},
		),
		{
			message: `https://releases.test/v0.5.7/prismalens-0.5.7-linux-x64.tar.gz has sha256 ${digest}; the launcher pins ${"0".repeat(64)}`,
		},
	);
	assert.equal(calls, 1);
	calls = 0;
	await assert.rejects(
		mirrorPublished(
			root,
			{ version: "0.5.8", sha256: { "linux-x64": digest } },
			{
				...opts,
				fetchImpl: async () => {
					calls++;
					return new Response("", { status: 404 });
				},
			},
		),
		{
			message:
				"https://releases.test/v0.5.8/prismalens-0.5.8-linux-x64.tar.gz answered 404",
		},
	);
	assert.equal(calls, 1);
	await assert.rejects(
		mirrorPublished(
			root,
			{ version: "0.5.9", sha256: { "linux-x64": digest } },
			{ ...opts, tries: 2, fetchImpl: async () => cutOff() },
		),
		{ message: "terminated" },
	);
});

const digestOf = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

function writeSums(dir, version) {
	writeFileSync(
		join(dir, "SHA256SUMS"),
		TARGETS.map((t) => {
			const n = archiveName(version, t);
			return `${digestOf(join(dir, n))}  ${n}\n`;
		}).join(""),
	);
}

/**
 * A release folder as `gh release download` leaves it: every target's archive and SHA256SUMS.
 * This runner's archive is a real one holding a tiny app; the others are bytes only.
 */
function draftFolder(name, version) {
	const dir = join(work, name);
	mkdirSync(dir, { recursive: true });
	const own = fakeArchive({
		version,
		app: `console.log("${version}");\n`,
		outDir: work,
	});
	for (const t of TARGETS) {
		const file = join(dir, archiveName(version, t));
		if (t === ownTarget()) copyFileSync(own, file);
		else writeFileSync(file, `bytes of ${file}`);
	}
	rmSync(own, { force: true });
	writeSums(dir, version);
	return dir;
}

/** Packs the launcher pinned to the digests in `dir`, as release.yml's `launcher` job does. */
const packPinned = (dir, version) =>
	packLauncher([
		"--assets",
		dir,
		"--version",
		version,
		"--out",
		join(work, `${basename(dir)}-launcher`),
	]);

const tarBin =
	process.platform === "win32"
		? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
		: "tar";

test("a launcher is pinned from a folder holding the release's archives, before the release is public", async () => {
	const dir = draftFolder("draft-pin", "0.5.6");
	const tgz = await packPinned(dir, "0.5.6");
	assert.deepEqual(launcherPins(tgz), {
		version: "0.5.6",
		sha256: Object.fromEntries(
			TARGETS.map((t) => [t, digestOf(join(dir, archiveName("0.5.6", t)))]),
		),
	});
});

test("a folder missing an archive or holding a changed one pins no launcher, and --assets never publishes", async () => {
	const dir = draftFolder("draft-refused", "0.5.6");
	const out = ["--version", "0.5.6", "--out", join(work, "never")];
	const linux = archiveName("0.5.6", "linux-x64");
	writeFileSync(join(dir, linux), "changed");
	await assert.rejects(packLauncher(["--assets", dir, ...out]), {
		message: `${dir} is not the complete release 0.5.6, so its launcher is not pinned: ${linux} does not match SHA256SUMS`,
	});
	writeSums(dir, "0.5.6");
	const windows = archiveName("0.5.6", "win32-x64");
	rmSync(join(dir, windows));
	await assert.rejects(packLauncher(["--assets", dir, ...out]), {
		message: `${dir} is not the complete release 0.5.6, so its launcher is not pinned: ${windows} is not attached`,
	});
	await assert.rejects(
		packLauncher(["--assets", dir, "--publish-dry-run", ...out]),
		{
			message:
				"--assets pins from a local folder; --publish reads the public release",
		},
	);
});

test("the draft's own archive is the one the mirror serves, and only with the digest its launcher pins", async () => {
	const dir = draftFolder("draft-mirror", "9.9.9");
	const archive = join(dir, archiveFile("9.9.9"));
	const launcher = await packPinned(dir, "9.9.9");
	const mirror = prepareDraftRelease({
		archive,
		launcher,
		work: join(work, "draft-mirror-work"),
		releases: [{ version: nightlyAfter("9.9.9") }],
	});
	assert.deepEqual(
		readFileSync(join(mirror.root, "v9.9.9", archiveFile("9.9.9"))),
		readFileSync(archive),
	);
	assert.equal(
		readFileSync(join(mirror.root, "v9.9.9", "SHA256SUMS"), "utf8"),
		`${digestOf(archive)}  ${archiveFile("9.9.9")}\n`,
	);
	assert.deepEqual(mirror.launchers, { "9.9.9": launcher });
	assert.deepEqual(Object.keys(mirror.archives), [
		"9.9.9",
		nightlyAfter("9.9.9"),
	]);

	const pinned = digestOf(archive);
	writeFileSync(archive, "an archive rebuilt after the launcher was packed");
	assert.throws(
		() =>
			prepareDraftRelease({
				archive,
				launcher,
				work: join(work, "draft-mirror-refused"),
			}),
		{
			message: `${archive} has sha256 ${digestOf(archive)}; the launcher pins ${pinned}`,
		},
	);
});

test("a launcher and an archive of two releases, or of another target, are refused", async () => {
	const dir = draftFolder("draft-versions", "9.9.8");
	const launcher = await packPinned(dir, "9.9.8");
	const other = join(
		draftFolder("draft-versions-other", "9.9.7"),
		archiveFile("9.9.7"),
	);
	assert.throws(() => prepareDraftRelease({ archive: other, launcher, work }), {
		message:
			"the launcher is 9.9.8 and the archive 9.9.7; they are not one release",
	});
	const archive = join(dir, archiveFile("9.9.8"));
	const another = TARGETS.find((t) => t !== ownTarget());
	assert.throws(
		() => assertPinnedArchive(launcherPins(launcher), archive, another),
		{
			message: `${archive} is not ${archiveFile("9.9.8", another)}, the archive of 9.9.8 for ${another}`,
		},
	);
	assert.throws(
		() => assertPinnedArchive({ version: "9.9.8", sha256: {} }, archive),
		{ message: `prismalens@9.9.8 pins no archive for ${ownTarget()}` },
	);
});

test("a release's archive retagged to a nightly keeps its bytes under the nightly's folder and version", () => {
	const archive = fakeArchive({
		version: "9.9.6",
		app: 'console.log("9.9.6");\n',
		outDir: work,
	});
	const nightly = nightlyAfter("9.9.6");
	const retagged = retagArchive(archive, nightly, work);
	assert.equal(basename(retagged), archiveFile(nightly));
	assert.equal(archiveVersion(retagged), nightly);
	const out = mkdtempSync(join(work, "retag-out-"));
	execFileSync(tarBin, ["-xf", retagged], { cwd: out });
	const top = `prismalens-${nightly}-${ownTarget()}`;
	assert.deepEqual(readdirSync(out), [top]);
	assert.equal(
		JSON.parse(readFileSync(join(out, top, "app", "package.json"), "utf8"))
			.version,
		nightly,
	);
	assert.equal(
		readFileSync(join(out, top, "app", "dist", "bin", "prismalens.js"), "utf8"),
		'console.log("9.9.6");\n',
	);
	assert.throws(() => archiveVersion("prismalens-9.9.6.tgz"), {
		message: "prismalens-9.9.6.tgz is not a prismalens standalone archive",
	});
});

test("npm publishes the packed launcher only while the public release holds the archives it pins", async () => {
	const dir = draftFolder("draft-public", "9.9.5");
	const launcher = await packPinned(dir, "9.9.5");
	const publicRoot = join(work, "public-root");
	const published = join(publicRoot, "v9.9.5");
	mkdirSync(published, { recursive: true });
	for (const t of TARGETS)
		copyFileSync(
			join(dir, archiveName("9.9.5", t)),
			join(published, archiveName("9.9.5", t)),
		);
	writeFileSync(join(published, archiveName("9.9.5", "darwin-x64")), "swapped");
	writeSums(published, "9.9.5");
	await assert.rejects(
		publishPacked(launcher, {
			dryRun: true,
			base: pathToFileURL(publicRoot).href,
		}),
		{
			message:
				"the public release no longer holds the archives the launcher pins: darwin-x64",
		},
	);
});
