#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The published `prismalens` npm package (#717): fetch this version's standalone archive from
// its GitHub release, check it against SHA256SUMS, cache it, run it. No dependencies.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const { release } = JSON.parse(
	fs.readFileSync(path.join(path.dirname(self), "../../package.json"), "utf8"),
).prismalens;
const win = process.platform === "win32";
const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
];
const DEFAULT_BASE =
	"https://github.com/prismalens/prismalens/releases/download";

function fail(message) {
	process.stderr.write(`prismalens: ${message}\n`);
	process.exit(1);
}

/** Beside the installer's `runtime/`, so the installer's pruning never removes it. */
function cacheRoot(env = process.env) {
	if (env.PRISMALENS_LAUNCHER_DIR)
		return path.resolve(env.PRISMALENS_LAUNCHER_DIR);
	const data = win
		? (env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"))
		: (env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"));
	return path.join(data, "prismalens", "npm");
}

const transient = (status) => status === 408 || status === 429 || status >= 500;

async function get(url) {
	if (url.startsWith("file:")) {
		const file = fileURLToPath(url);
		if (!fs.existsSync(file)) throw new Error(`${file} does not exist`);
		return new Response(Readable.toWeb(fs.createReadStream(file)), {
			headers: { "content-length": String(fs.statSync(file).size) },
		});
	}
	let response;
	for (let attempt = 1; ; attempt++) {
		try {
			response = await fetch(url);
			if (attempt === 4 || !transient(response.status)) break;
			await response.body?.cancel();
		} catch (error) {
			if (attempt === 4) throw error;
		}
		await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
	}
	if (response.status === 404)
		throw new Error(
			`${url} does not exist. If ${release.version} was just released, try again in a few minutes.`,
		);
	if (!response.ok)
		throw new Error(`GET ${url} returned HTTP ${response.status}`);
	return response;
}

async function download(url, file) {
	const response = await get(url);
	const total = Number(response.headers.get("content-length")) || 0;
	const hash = createHash("sha256");
	const out = fs.openSync(file, "w");
	const tty = process.stderr.isTTY;
	let received = 0;
	let shown = -1;
	try {
		for await (const chunk of response.body) {
			hash.update(chunk);
			fs.writeSync(out, chunk);
			received += chunk.byteLength;
			const pct = total ? Math.floor((received * 100) / total) : -1;
			if (tty && pct !== shown) {
				shown = pct;
				process.stderr.write(
					`\r\x1b[2Kprismalens: downloading ${release.version}${total ? ` ${pct}%` : ""} (${(received / 1048576).toFixed(1)} MB)`,
				);
			}
		}
	} finally {
		fs.closeSync(out);
		if (tty) process.stderr.write("\r\x1b[2K");
	}
	return hash.digest("hex");
}

const entryOf = (dir) => ({
	node: win
		? path.join(dir, "node", "node.exe")
		: path.join(dir, "node", "bin", "node"),
	app: path.join(dir, "app", "dist", "bin", "prismalens.js"),
});

const complete = (dir) => {
	try {
		return (
			fs.readFileSync(path.join(dir, ".complete"), "utf8").trim() ===
			release.version
		);
	} catch {
		return false;
	}
};

async function install(dir, target) {
	const proxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
	if (proxy.some((k) => process.env[k]) && http.setGlobalProxyFromEnv)
		http.setGlobalProxyFromEnv();
	const base = (
		process.env.PRISMALENS_RELEASE_BASE_URL || DEFAULT_BASE
	).replace(/\/+$/, "");
	const archive = `prismalens-${release.version}-${target}.${win ? "zip" : "tar.gz"}`;
	const sums = await (await get(`${base}/${release.tag}/SHA256SUMS`)).text();
	const expected = sums
		.split(/\r?\n/)
		.map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(l.trim()))
		.find((m) => m && m[2] === archive);
	if (!expected)
		throw new Error(`${archive} is not listed in ${release.tag}'s SHA256SUMS`);

	fs.mkdirSync(path.dirname(dir), { recursive: true });
	const staging = fs.mkdtempSync(`${dir}.staging-`);
	try {
		const file = path.join(staging, archive);
		const actual = await download(`${base}/${release.tag}/${archive}`, file);
		if (actual !== expected[1].toLowerCase())
			throw new Error(
				`checksum mismatch for ${archive} (expected ${expected[1]}, got ${actual}); nothing was installed`,
			);
		// Windows' own bsdtar reads zip; a Git-for-Windows tar on PATH cannot.
		const tar = win
			? path.join(
					process.env.SystemRoot ?? "C:\\Windows",
					"System32",
					"tar.exe",
				)
			: "tar";
		const x = spawnSync(tar, ["-xf", archive, "--strip-components=1"], {
			cwd: staging,
			stdio: "inherit",
			windowsHide: true,
		});
		fs.rmSync(file, { force: true });
		if (x.status !== 0) throw new Error(`could not extract ${archive}`);
		const { node, app } = entryOf(staging);
		if (!fs.existsSync(node) || !fs.existsSync(app))
			throw new Error(`${archive} has no node or app inside`);
		fs.writeFileSync(path.join(staging, ".complete"), `${release.version}\n`);
		try {
			fs.renameSync(staging, dir);
		} catch (error) {
			if (complete(dir)) return;
			if (!fs.existsSync(dir)) throw error;
			fs.rmSync(dir, { recursive: true, force: true });
			fs.renameSync(staging, dir);
		}
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

async function main() {
	const target = `${process.platform}-${process.arch}`;
	if (!TARGETS.includes(target))
		fail(
			`there is no PrismaLens build for ${target} (builds: ${TARGETS.join(", ")}).`,
		);
	const dir = path.join(cacheRoot(), release.version);
	if (!complete(dir)) await install(dir, target).catch((e) => fail(e.message));

	const { node, app } = entryOf(dir);
	const env = {
		...process.env,
		PRISMALENS_LAUNCHER: path.resolve(process.argv[1]),
		PRISMALENS_LAUNCHER_NODE: process.execPath,
	};
	// The archive's own bin scripts say "installer"; through npm the channel is npm.
	delete env.PRISMALENS_INSTALL;
	const child = spawn(node, [app, ...process.argv.slice(2)], {
		stdio: "inherit",
		env,
		windowsHide: true,
	});
	// A terminal's Ctrl-C already reaches the child through the process group.
	for (const signal of ["SIGTERM", "SIGHUP"])
		process.on(signal, () => child.kill(signal));
	process.on("SIGINT", () => process.stdin.isTTY || child.kill("SIGINT"));
	child.on("error", (e) => fail(`could not run ${node}: ${e.message}`));
	child.on("exit", (code, signal) =>
		process.exit(code ?? 128 + (os.constants.signals[signal] ?? 1)),
	);
}

await main();
