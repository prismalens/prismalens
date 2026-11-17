// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Test fixtures for the launcher (#717): the launcher laid out as its npm package, release
// mirrors holding small real archives, a local TLS server, and an async child runner.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launcherManifest } from "../pack-launcher.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WIN = process.platform === "win32";
export const HOST = `${process.platform}-${process.arch}`;
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const made = [];
// Each archive holds a copy of node; a run leaves none of them behind.
process.on("exit", () => {
	for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

export function workdir(prefix = "pl-launcher-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	made.push(dir);
	return dir;
}

/** The three launcher files and a manifest at `version`, as npm would install them. */
export function installLauncher(dir, version = "0.5.6", pins = undefined) {
	const bin = join(dir, "dist", "bin");
	mkdirSync(bin, { recursive: true });
	copyFileSync(join(HERE, "prismalens.mjs"), join(bin, "prismalens.js"));
	// PL_LAUNCHER_SOURCE runs these tests against another launcher, to show a fix fails before it.
	copyFileSync(
		process.env.PL_LAUNCHER_SOURCE ?? join(HERE, "launcher.mjs"),
		join(bin, "launcher.mjs"),
	);
	const manifest = launcherManifest(
		{ name: "prismalens", version: "0.0.0", license: "Apache-2.0" },
		{ version },
	);
	if (pins) manifest.prismalens.release.sha256 = pins;
	writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
	return join(bin, "prismalens.js");
}

/**
 * The stand-in app: prints what it was started with, and with `--signals` logs every signal
 * to a file, finishing a slow shutdown on the first and exiting at once on a second, as
 * the API does (packages/api/src/main.ts, armForcedExitOnSecondSignal).
 */
const APP = `
const fs = require("node:fs");
const a = process.argv.slice(2);
const version = require("../../package.json").version;
if (a[0] === "--signals") {
	const log = a[1];
	let natives = 0;
	let stopping = false;
	// As Nest does: hooks run, the listeners go, then the signal is raised again to die by it.
	const shutdown = (why) => {
		fs.appendFileSync(log, why + "\\n");
		setTimeout(() => {
			fs.appendFileSync(log, "clean\\n");
			process.removeAllListeners("SIGTERM");
			process.removeAllListeners("SIGINT");
			process.kill(process.pid, "SIGTERM");
		}, 800);
	};
	const onSignal = (s) => {
		if (++natives > 1) { fs.appendFileSync(log, "forced\\n"); process.exit(99); }
		if (stopping) return;
		stopping = true;
		shutdown(s);
	};
	process.on("SIGTERM", onSignal);
	process.on("SIGINT", onSignal);
	process.on("message", (m) => {
		if (m !== "prismalens:stop" || stopping) return;
		stopping = true;
		shutdown("stop request");
	});
	process.channel?.unref();
	fs.appendFileSync(log, "ready\\n");
	setInterval(() => {}, 1000);
} else {
	console.log(JSON.stringify({ version, argv: a, launcher: process.env.PRISMALENS_LAUNCHER ?? null, channel: process.env.PRISMALENS_RUNTIME_CHANNEL ?? null, install: process.env.PRISMALENS_INSTALL ?? null }));
	const i = a.indexOf("--exit");
	process.exitCode = i === -1 ? 0 : Number(a[i + 1]);
}
`;

let nodeCopy;
/** A real archive in `mirror/v<version>/` with SHA256SUMS, laid out as build-standalone.mjs does. */
export function release(mirror, version, opts = {}) {
	const target = opts.target ?? HOST;
	const win = target.startsWith("win32");
	const top = `prismalens-${version}-${target}`;
	const stage = mkdtempSync(join(tmpdir(), "pl-stage-"));
	const root = join(stage, top);
	mkdirSync(join(root, "app", "dist", "bin"), { recursive: true });
	writeFileSync(
		join(root, "app", "package.json"),
		JSON.stringify({ name: "prismalens", version }),
	);
	writeFileSync(join(root, "app", "dist", "bin", "prismalens.js"), APP);
	const schema = join(
		root,
		"app",
		"node_modules",
		"@prismalens",
		"database",
		"dist",
		"prisma",
		"sqlite",
		"schema",
	);
	for (const m of opts.migrations ?? ["20260901000000_init"]) {
		mkdirSync(join(schema, m), { recursive: true });
		writeFileSync(join(schema, m, "migration.sql"), "SELECT 1;\n");
	}
	if (win) {
		mkdirSync(join(root, "node"));
		if (target === HOST) {
			if (!nodeCopy) {
				nodeCopy = join(workdir("pl-node-"), "node.exe");
				copyFileSync(process.execPath, nodeCopy);
			}
			linkSync(nodeCopy, join(root, "node", "node.exe"));
		} else writeFileSync(join(root, "node", "node.exe"), "not this machine's");
	} else {
		mkdirSync(join(root, "node", "bin"), { recursive: true });
		writeFileSync(
			join(root, "node", "bin", "node"),
			`#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
		);
		chmodSync(join(root, "node", "bin", "node"), 0o755);
	}
	const name = `${top}.${win ? "zip" : "tar.gz"}`;
	const dir = join(mirror, `v${version}`);
	mkdirSync(dir, { recursive: true });
	const tar = WIN ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
	const args = win
		? ["-a", "--options", "zip:compression=store", "-cf"]
		: ["-czf"];
	execFileSync(tar, [...args, join(dir, name), top], { cwd: stage });
	rmSync(stage, { recursive: true, force: true });
	const digest = opts.tamper
		? "0".repeat(64)
		: sha256(readFileSync(join(dir, name)));
	const sums = join(dir, "SHA256SUMS");
	const prior = existsSync(sums) ? readFileSync(sums, "utf8") : "";
	writeFileSync(sums, `${prior}${digest}  ${name}\n`);
	return { name, url: pathToFileURL(mirror).href };
}

let cert;
/** A self-signed localhost certificate, made once per run with the openssl CLI. */
export function tlsCert() {
	if (cert) return cert;
	const dir = workdir("pl-tls-");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"1",
			"-keyout",
			join(dir, "key.pem"),
			"-out",
			join(dir, "cert.pem"),
			"-subj",
			"/CN=localhost",
			"-addext",
			"subjectAltName=DNS:localhost,IP:127.0.0.1",
		],
		{ stdio: "ignore", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } },
	);
	cert = {
		key: readFileSync(join(dir, "key.pem")),
		cert: readFileSync(join(dir, "cert.pem")),
		file: join(dir, "cert.pem"),
	};
	return cert;
}

/** An https server on 127.0.0.1; `handler(req, res)` sees every request, `hits` counts paths. */
export async function httpsServer(handler) {
	const { key, cert: c } = tlsCert();
	const hits = new Map();
	const server = https.createServer({ key, cert: c }, (req, res) => {
		hits.set(req.url, (hits.get(req.url) ?? 0) + 1);
		handler(req, res);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	return {
		url: `https://127.0.0.1:${server.address().port}`,
		hits,
		server,
		close: () => server.close(),
	};
}

/** Serves a directory over https, as a release mirror. */
export function serveDir(root) {
	return (req, res) => {
		const file = join(
			root,
			decodeURIComponent(new URL(req.url, "https://x").pathname),
		);
		if (!existsSync(file) || !file.startsWith(root))
			return res.writeHead(404).end();
		res
			.writeHead(200, { "content-length": readFileSync(file).length })
			.end(readFileSync(file));
	};
}

/** Runs the launcher with `node`; resolves {status, stdout, stderr, ms}. */
export function launch(bin, args, env, opts = {}) {
	const started = Date.now();
	return new Promise((done) => {
		const child = spawn(process.execPath, [bin, ...args], {
			env: { ...process.env, PRISMALENS_RELEASE_BASE_URL: "", ...env },
			windowsHide: true,
			...opts,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d) => {
			stdout += d;
		});
		child.stderr?.on("data", (d) => {
			stderr += d;
		});
		child.on("close", (status, signal) =>
			done({
				status,
				signal,
				stdout,
				stderr,
				ms: Date.now() - started,
				pid: child.pid,
			}),
		);
		opts.onSpawn?.(child);
	});
}

export const lastJson = (out) => JSON.parse(out.trim().split("\n").at(-1));
