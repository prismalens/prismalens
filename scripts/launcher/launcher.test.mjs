// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What npm serves and when (#717): the packed launcher's guards, the publish refusals, the
// release completeness check, and an install through a registry that drops bundle metadata
// the way a JFrog Artifactory remote did.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { basename, dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	assertLauncherEntries,
	assertLauncherManifest,
	assertPinned,
	assertPublishable,
	ENTRIES,
	launcherManifest,
	packLauncher,
} from "../pack-launcher.mjs";
import {
	archiveName,
	missing,
	TARGETS,
	verifyDir,
	verifyPublic,
} from "../release-complete.mjs";
import { HOST, lastJson, release, WIN, workdir } from "./fixtures.mjs";

const work = workdir();
const cli = { name: "prismalens", version: "0.5.6", license: "Apache-2.0" };
const sha = (buf, algo = "sha256", enc = "hex") =>
	createHash(algo).update(buf).digest(enc);
const npmEnv = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)),
);
const argvOf = (cmd, args) =>
	WIN && (cmd === "npm" || cmd.endsWith(".cmd"))
		? ["cmd.exe", ["/d", "/c", cmd, ...args]]
		: [cmd, args];
const sh = (cmd, args, options = {}) =>
	spawnSync(...argvOf(cmd, args), {
		encoding: "utf8",
		windowsHide: true,
		...options,
	});

/** Async, so the registry served from this process can answer. */
function run(cmd, args, options = {}) {
	const [file, list] = argvOf(cmd, args);
	return new Promise((done) => {
		const child = spawn(file, list, { windowsHide: true, ...options });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("close", (status) => done({ status, stdout, stderr }));
	});
}

test("the manifest guard refuses anything a proxy could chase", () => {
	const good = launcherManifest(cli);
	assertLauncherManifest(good);
	assert.deepEqual(good.prismalens.release, {
		channel: "stable",
		tag: "v0.5.6",
		version: "0.5.6",
	});
	for (const bad of [
		{ bundleDependencies: ["@prismalens/api"] },
		{ bundledDependencies: [] },
		{ dependencies: { "@prismalens/api": "0.0.1" } },
		{ optionalDependencies: { esbuild: "1" } },
		{ peerDependencies: {} },
		{ scripts: { postinstall: "x" } },
		{ prismalens: {} },
	])
		assert.throws(() => assertLauncherManifest({ ...good, ...bad }));
	assert.throws(() =>
		assertLauncherEntries([...ENTRIES, "package/node_modules/x/index.js"]),
	);
});

test("npm gets stable launchers only, and only for a release that is public and complete", async () => {
	await assert.rejects(
		assertPublishable(
			launcherManifest(cli, { version: "0.5.7-nightly.20261117.3" }),
		),
		/npm carries stable launchers only; 0\.5\.7-nightly\.20261117\.3 is a nightly version/,
	);
	const mirror = join(work, "publish-mirror");
	mkdirSync(mirror, { recursive: true });
	await assert.rejects(
		assertPublishable(launcherManifest(cli), pathToFileURL(mirror).href),
		/release v0\.5\.6 is not public and complete, so its launcher is not published: SHA256SUMS is not attached/,
	);
	const r = sh(
		process.execPath,
		[
			fileURLToPath(new URL("../pack-launcher.mjs", import.meta.url)),
			"--publish-dry-run",
			"--version",
			"0.0.0-nonexistent",
			"--out",
			join(work, "never"),
		],
		{},
	);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /npm carries stable launchers only/);
	const r2 = sh(
		process.execPath,
		[
			fileURLToPath(new URL("../pack-launcher.mjs", import.meta.url)),
			"--publish-dry-run",
			"--version",
			"0.0.1",
			"--release-base",
			pathToFileURL(mirror).href,
			"--out",
			join(work, "never"),
		],
		{},
	);
	assert.equal(r2.status, 1);
	assert.match(r2.stderr, /release v0\.0\.1 is not public and complete/);
});

test("a release whose SHA256SUMS lines are zeros, or missing an archive, is incomplete", async () => {
	const v = "0.5.6";
	const dir = join(work, "complete", `v${v}`);
	mkdirSync(dir, { recursive: true });
	const names = TARGETS.map((t) => archiveName(v, t));
	for (const n of names) writeFileSync(join(dir, n), n);
	writeFileSync(
		join(dir, "SHA256SUMS"),
		names.map((n) => `${sha(readFileSync(join(dir, n)))}  ${n}`).join("\n"),
	);
	const base = pathToFileURL(join(work, "complete")).href;
	assert.deepEqual(await verifyPublic({ base, tag: `v${v}`, version: v }), []);
	assert.deepEqual(await verifyDir(dir, v), []);
	writeFileSync(
		join(dir, "SHA256SUMS"),
		names.map((n) => `${"0".repeat(64)}  ${n}`).join("\n"),
	);
	assert.deepEqual(
		await verifyPublic({ base, tag: `v${v}`, version: v }),
		names.map((n) => `${n} does not match SHA256SUMS`),
	);
	const hashes = new Map(names.map((n) => [n, "a".repeat(64)]));
	const sums = names.map((n) => `${"a".repeat(64)}  ${n}`).join("\n");
	hashes.delete(archiveName(v, "win32-x64"));
	assert.deepEqual(missing(v, hashes, sums), [
		"prismalens-0.5.6-win32-x64.zip is not attached",
	]);
	assert.deepEqual(missing(v, hashes, null), ["SHA256SUMS is not attached"]);
});

test("the app tarball refuses to publish, before building anything", () => {
	for (const flag of ["--publish", "--publish-dry-run"]) {
		const r = sh(process.execPath, [
			fileURLToPath(new URL("../pack-cli.mjs", import.meta.url)),
			flag,
		]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /never published/);
	}
});

test("no workflow publishes the app tarball or a nightly; only pack-launcher.mjs publishes prismalens", () => {
	const dir = new URL("../../.github/workflows/", import.meta.url);
	const publishers = [];
	for (const f of readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
		for (const line of readFileSync(new URL(f, dir), "utf8").split("\n")) {
			if (/^\s*#/.test(line)) continue;
			const where = `${f}: ${line.trim()}`;
			if (/--publish\b/.test(line)) {
				assert.match(line, /node scripts\/pack-launcher\.mjs /, where);
				assert.doesNotMatch(line, /nightly/, where);
				publishers.push(f);
			}
			if (/\b(npm|pnpm)\s+publish\b/.test(line))
				assert.doesNotMatch(
					line,
					/pack-cli|packages\/cli|dist-pack\/prismalens|prismalens-(\$|\d)/,
					where,
				);
			assert.doesNotMatch(line, /npm\s+dist-tag\s+add\s+prismalens/, where);
		}
	}
	assert.deepEqual(publishers, ["release.yml"]);
});

test("the launcher, the archive build and the publish guard name the same targets", () => {
	const listIn = (file, re) =>
		JSON.parse(
			`[${re.exec(readFileSync(new URL(file, import.meta.url), "utf8"))[1].replace(/,\s*$/, "")}]`,
		).sort();
	assert.deepEqual(
		listIn("./launcher.mjs", /export const TARGETS = \[([^\]]+)\]/),
		[...TARGETS].sort(),
	);
	assert.deepEqual(
		listIn("../build-standalone.mjs", /const valid = \[([^\]]+)\]/),
		[...TARGETS].sort(),
	);
});

// --- the stripping registry -------------------------------------------------------------------

const packages = new Map();
let server;
let registry;

function serve(tgz) {
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", basename(tgz), "package/package.json"], {
			cwd: dirname(tgz),
			encoding: "utf8",
		}),
	);
	packages.set(manifest.name, { manifest, tgz: readFileSync(tgz) });
}

before(async () => {
	server = http.createServer((req, res) => {
		const url = decodeURIComponent(req.url ?? "");
		const tarball = /^\/-\/(.+)\.tgz$/.exec(url);
		if (tarball) {
			const pkg = packages.get(tarball[1]);
			return pkg ? res.writeHead(200).end(pkg.tgz) : res.writeHead(404).end();
		}
		const pkg = packages.get(url.slice(1));
		if (!pkg) return res.writeHead(404).end(`{"error":"not found"}`);
		const v = { ...pkg.manifest };
		delete v.bundleDependencies;
		delete v.bundledDependencies;
		v.dist = {
			tarball: `${registry}-/${pkg.manifest.name}.tgz`,
			shasum: sha(pkg.tgz, "sha1"),
			integrity: `sha512-${sha(pkg.tgz, "sha512", "base64")}`,
		};
		res.writeHead(200, { "content-type": "application/json" }).end(
			JSON.stringify({
				name: v.name,
				"dist-tags": { latest: v.version },
				versions: { [v.version]: v },
			}),
		);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	registry = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

function install(name, prefix) {
	writeFileSync(join(work, ".npmrc"), "");
	return run(
		"npm",
		["install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", name],
		{
			env: {
				...npmEnv,
				NPM_CONFIG_REGISTRY: registry,
				NPM_CONFIG_USERCONFIG: join(work, ".npmrc"),
				NPM_CONFIG_CACHE: join(work, "npm-cache"),
			},
		},
	);
}

test("control: a package bundling @prismalens/* fails through the stripping registry", async () => {
	const dir = join(work, "fat");
	mkdirSync(join(dir, "node_modules", "@prismalens", "api"), {
		recursive: true,
	});
	writeFileSync(
		join(dir, "node_modules", "@prismalens", "api", "package.json"),
		'{"name":"@prismalens/api","version":"0.0.1"}',
	);
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "fat-control",
			version: "1.0.0",
			dependencies: { "@prismalens/api": "0.0.1" },
			bundleDependencies: ["@prismalens/api"],
		}),
	);
	const out = sh("npm", ["pack", "--pack-destination", work, "--json"], {
		cwd: dir,
		env: npmEnv,
	});
	assert.equal(out.status, 0, out.stderr);
	serve(join(work, JSON.parse(out.stdout)[0].filename));
	const r = await install("fat-control", join(work, "fat-prefix"));
	assert.notEqual(r.status, 0, "the stripping registry let a bundle through");
	assert.match(r.stderr, /E404[\s\S]*@prismalens\/api/);
});

test("the packed launcher installs through it, then fetches, verifies and runs its archive", async () => {
	const tgz = await packLauncher([
		"--out",
		join(work, "launcher"),
		"--version",
		"0.5.6",
	]);
	serve(tgz);
	const prefix = join(work, "prefix");
	const r = await install("prismalens", prefix);
	assert.equal(r.status, 0, r.stderr);
	const pl = WIN ? join(prefix, "pl.cmd") : join(prefix, "bin", "pl");
	const { url } = release(join(work, "mirror"), "0.5.6");
	const env = {
		...process.env,
		PRISMALENS_LAUNCHER_DIR: join(work, "cache"),
		PRISMALENS_RELEASE_BASE_URL: url,
	};
	const ran = sh(pl, ["hello", "--exit", "7"], { env });
	assert.equal(ran.status, 7, ran.stderr);
	const seen = lastJson(ran.stdout);
	assert.deepEqual(
		[seen.version, seen.argv],
		["0.5.6", ["hello", "--exit", "7"]],
	);
	assert.ok(seen.launcher);
	assert.ok(HOST);
});

test("a published launcher pins each target's archive digest, read anonymously from its release", async () => {
	const v = "0.5.6";
	const dir = join(work, "pins", `v${v}`);
	mkdirSync(dir, { recursive: true });
	const names = TARGETS.map((t) => archiveName(v, t));
	for (const n of names) writeFileSync(join(dir, n), `bytes of ${n}`);
	writeFileSync(
		join(dir, "SHA256SUMS"),
		names.map((n) => `${sha(readFileSync(join(dir, n)))}  ${n}`).join("\n"),
	);
	const base = pathToFileURL(join(work, "pins")).href;
	const tgz = await packLauncher([
		"--pin",
		"--release-base",
		base,
		"--version",
		v,
		"--out",
		join(work, "pinned"),
	]);
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", basename(tgz), "package/package.json"], {
			cwd: dirname(tgz),
			encoding: "utf8",
		}),
	);
	assert.deepEqual(
		manifest.prismalens.release.sha256,
		Object.fromEntries(
			TARGETS.map((t) => [t, sha(readFileSync(join(dir, archiveName(v, t))))]),
		),
	);
	assertPinned(manifest);
	assert.throws(
		() => assertPinned(launcherManifest(cli)),
		/pins no archive digest for darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64/,
	);
});
