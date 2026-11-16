// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The npm launcher end to end, installed through a registry that drops bundle metadata the way
// a JFrog Artifactory remote did (#717): a package that bundles @prismalens/* fails there; the
// launcher installs, fetches its archive from a release mirror, checks it and runs it.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	assertLauncherEntries,
	assertLauncherManifest,
	ENTRIES,
	launcherManifest,
	packLauncher,
} from "../pack-launcher.mjs";
import { archiveName, missing, TARGETS } from "../release-complete.mjs";

const WIN = process.platform === "win32";
const TARGET = `${process.platform}-${process.arch}`;
const work = mkdtempSync(join(tmpdir(), "pl-launcher-"));
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

function sh(cmd, args, options = {}) {
	const [file, list] = argvOf(cmd, args);
	return spawnSync(file, list, {
		encoding: "utf8",
		windowsHide: true,
		...options,
	});
}

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

test("the channel is a parameter; a nightly version defaults to nightly", () => {
	const nightly = launcherManifest({ ...cli, version: "0.5.6-nightly.1.2" });
	assert.equal(nightly.prismalens.release.channel, "nightly");
	const pinned = launcherManifest(cli, {
		channel: "nightly",
		releaseTag: "v0.5.7-nightly.20261117.12",
		releaseVersion: "0.5.7-nightly.20261117.12",
	});
	assert.equal(pinned.prismalens.release.tag, "v0.5.7-nightly.20261117.12");
	assert.throws(() => launcherManifest(cli, { channel: "beta" }));
});

test("the app tarball refuses to publish, before building anything", () => {
	for (const flag of ["--publish", "--publish-dry-run"]) {
		const r = spawnSync(
			process.execPath,
			[fileURLToPath(new URL("../pack-cli.mjs", import.meta.url)), flag],
			{ encoding: "utf8", windowsHide: true },
		);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /never published/);
	}
});

test("the launcher, the archive build and the publish guard name the same targets", () => {
	const listIn = (file, re) =>
		JSON.parse(
			`[${re
				.exec(readFileSync(new URL(file, import.meta.url), "utf8"))[1]
				.replace(/,\s*$/, "")}]`,
		).sort();
	assert.deepEqual(
		listIn("./prismalens.mjs", /const TARGETS = \[([^\]]+)\]/),
		[...TARGETS].sort(),
	);
	assert.deepEqual(
		listIn("../build-standalone.mjs", /const valid = \[([^\]]+)\]/),
		[...TARGETS].sort(),
	);
});

test("a release missing an archive or its SHA256SUMS line is incomplete", () => {
	const v = "0.5.6";
	const all = new Set(TARGETS.map((t) => archiveName(v, t)));
	const sums = [...all].map((n) => `${"a".repeat(64)}  ${n}`).join("\n");
	assert.deepEqual(missing(v, all, sums), []);
	assert.deepEqual(missing(v, all, null), ["SHA256SUMS is not attached"]);
	const less = new Set(all);
	less.delete(archiveName(v, "win32-x64"));
	assert.deepEqual(missing(v, less, sums), [
		"prismalens-0.5.6-win32-x64.zip is not attached",
	]);
	assert.deepEqual(missing(v, all, sums.split("\n").slice(1).join("\n")), [
		"prismalens-0.5.6-darwin-arm64.tar.gz is not in SHA256SUMS",
	]);
	assert.deepEqual(
		missing(v, all, sums, () => "b".repeat(64)).length,
		TARGETS.length,
	);
});

// --- the stripping registry and a release mirror ---------------------------------------------

const packages = new Map(); // name -> {manifest, tgz}
let server;
let registry;

function pack(dir) {
	const out = sh("npm", ["pack", "--pack-destination", work, "--json"], {
		cwd: dir,
		env: npmEnv,
	});
	assert.equal(out.status, 0, out.stderr);
	return join(work, JSON.parse(out.stdout)[0].filename);
}

function serve(tgz) {
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", basename(tgz), "package/package.json"], {
			cwd: dirname(tgz),
			encoding: "utf8",
		}),
	);
	packages.set(manifest.name, { manifest, tgz: readFileSync(tgz) });
}

function release(version, tamper = false) {
	const mirror = mkdtempSync(join(work, "mirror-"));
	const top = `prismalens-${version}-${TARGET}`;
	const stage = join(work, `stage-${basename(mirror)}`, top);
	mkdirSync(join(stage, "app", "dist", "bin"), { recursive: true });
	writeFileSync(
		join(stage, "app", "dist", "bin", "prismalens.js"),
		`const a = process.argv.slice(2);
console.log(JSON.stringify({ argv: a, launcher: process.env.PRISMALENS_LAUNCHER ?? null, install: process.env.PRISMALENS_INSTALL ?? null }));
process.exit(Number(a[a.indexOf("--exit") + 1] ?? 0));\n`,
	);
	if (WIN) {
		mkdirSync(join(stage, "node"));
		copyFileSync(process.execPath, join(stage, "node", "node.exe"));
	} else {
		mkdirSync(join(stage, "node", "bin"), { recursive: true });
		writeFileSync(
			join(stage, "node", "bin", "node"),
			`#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
		);
		chmodSync(join(stage, "node", "bin", "node"), 0o755);
	}
	const name = `${top}.${WIN ? "zip" : "tar.gz"}`;
	mkdirSync(join(mirror, `v${version}`));
	const archive = join(mirror, `v${version}`, name);
	const tar = WIN ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
	execFileSync(tar, [WIN ? "-a" : "-z", "-cf", archive, top], {
		cwd: join(stage, ".."),
	});
	const digest = tamper ? "0".repeat(64) : sha(readFileSync(archive));
	writeFileSync(
		join(mirror, `v${version}`, "SHA256SUMS"),
		`${digest}  ${name}\n`,
	);
	return pathToFileURL(mirror).href;
}

before(async () => {
	server = http.createServer((req, res) => {
		const url = decodeURIComponent(req.url ?? "");
		const tarball = /^\/-\/(.+)\.tgz$/.exec(url);
		if (tarball) {
			const pkg = packages.get(tarball[1]);
			if (!pkg) return res.writeHead(404).end();
			return res
				.writeHead(200, { "content-type": "application/octet-stream" })
				.end(pkg.tgz);
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

after(() => {
	server?.close();
	rmSync(work, { recursive: true, force: true });
});

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
	serve(pack(dir));
	const r = await install("fat-control", join(work, "fat-prefix"));
	assert.notEqual(r.status, 0, "the stripping registry let a bundle through");
	assert.match(r.stderr, /E404[\s\S]*@prismalens\/api/);
});

test("the launcher installs through it, fetches, verifies, caches and runs its archive", async () => {
	const tgz = packLauncher(["--out", join(work, "launcher")]);
	serve(tgz);
	const { version } = packages.get("prismalens").manifest;
	const prefix = join(work, "prefix");
	const r = await install("prismalens", prefix);
	assert.equal(r.status, 0, r.stderr);
	const pl = WIN ? join(prefix, "pl.cmd") : join(prefix, "bin", "pl");
	const cache = join(work, "cache");
	const env = {
		...process.env,
		PRISMALENS_LAUNCHER_DIR: cache,
		PRISMALENS_INSTALL: "standalone",
	};

	const run = sh(pl, ["hello", "--exit", "7"], {
		env: { ...env, PRISMALENS_RELEASE_BASE_URL: release(version) },
	});
	assert.equal(run.status, 7, run.stderr);
	const seen = JSON.parse(run.stdout.trim().split("\n").at(-1));
	assert.deepEqual(seen.argv, ["hello", "--exit", "7"]);
	assert.equal(seen.install, null);
	assert.ok(seen.launcher);
	assert.equal(
		readFileSync(join(cache, version, ".complete"), "utf8").trim(),
		version,
	);

	const offline = sh(pl, ["--exit", "0"], {
		env: { ...env, PRISMALENS_RELEASE_BASE_URL: "http://127.0.0.1:9/none" },
	});
	assert.equal(offline.status, 0, offline.stderr);

	const tampered = sh(pl, ["--exit", "0"], {
		env: {
			...env,
			PRISMALENS_LAUNCHER_DIR: join(work, "cache-2"),
			PRISMALENS_RELEASE_BASE_URL: release(version, true),
		},
	});
	assert.equal(tampered.status, 1);
	assert.match(tampered.stderr, /checksum mismatch/);
	assert.throws(() =>
		readFileSync(join(work, "cache-2", version, ".complete")),
	);
});
