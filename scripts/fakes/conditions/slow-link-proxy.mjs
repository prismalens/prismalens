#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// net.slow-link (#1101): a spotty mobile link in front of a running PrismaLens UI, for any
// browser, or the operator's phone with --host 0.0.0.0. Toxiproxy shapes TCP, so the UI's HTTP, SSE and
// WebSocket streams all cross it. `up` measures the shaping on a probe and writes the stamp.
//   node scripts/fakes/conditions/slow-link-proxy.mjs up --target 127.0.0.1:3310 --port 3330
//   node scripts/fakes/conditions/slow-link-proxy.mjs drop --for 10
//   node scripts/fakes/conditions/slow-link-proxy.mjs down
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { connect as connectTcp, createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { arg, freePort, sleep, stateDir } from "./lib.mjs";
import { conditionEntry, writeStamp } from "./stamp.mjs";

/** The net.slow-link entry's profile; these defaults only until the entry is registered. */
function slowLink() {
	const fallback = {
		rttMs: 400,
		downKbps: 1600,
		upKbps: 750,
		drops: [{ atS: "mid", forS: 10 }],
	};
	try {
		return { ...fallback, ...conditionEntry("net.slow-link").profile };
	} catch {
		return fallback;
	}
}
const SLOW_LINK = slowLink();

/** A link that came up stays up when its stamp cannot be written; say why instead. */
function stamp(/** @type {Record<string, unknown>} */ observed, detail) {
	try {
		writeStamp({
			condition: "net.slow-link",
			simulator: "net.throttle",
			observed,
			detail,
		});
	} catch (e) {
		console.error(
			`No stamp: ${e instanceof Error ? e.message.split(/\r?\n/)[0] : String(e)}`,
		);
	}
}

const VERSION = "2.13.0";
/** From the release's checksums.txt; a download that differs is refused. */
const SHA256 = {
	"windows-amd64":
		"04b710eefd7690c89f7cc67289e3e14618f1ff3c26e4a5f752a34a879b895bab",
	"linux-amd64":
		"bf529e8bb9a05cd293f45a3f1d0aa66ff9469680dcdca7e0ebeae21f1b83de89",
	"linux-arm64":
		"9a7e2db359153772f26f9382adf5cd7305ee9d4cb2d4956922b5df38fe16c37e",
	"darwin-amd64":
		"d41cf6ce269a3ea113461e54139881f901955ed11dabb60861217b69a4c8176f",
	"darwin-arm64":
		"21e5d0cbfc4af6e9967f617ee7a1645fa26181220fee3961630311a8de14705c",
};
const STATE = stateDir("slow-link");
const STATE_FILE = join(STATE, "state.json");
const saved = existsSync(STATE_FILE)
	? JSON.parse(readFileSync(STATE_FILE, "utf8"))
	: {};
const ADMIN_PORT = Number(
	arg("--admin-port") ??
		saved.adminPort ??
		process.env.PRISMALENS_TOXIPROXY_PORT ??
		8474,
);
const ADMIN = `http://127.0.0.1:${ADMIN_PORT}`;
const PROXY = "prismalens";
const PROBE = "prismalens-probe";

/** The pinned server binary, downloaded once and checked against its hash. */
async function serverBinary() {
	const os = { win32: "windows", linux: "linux", darwin: "darwin" }[
		process.platform
	];
	const cpu = { x64: "amd64", arm64: "arm64" }[process.arch];
	const key = /** @type {keyof typeof SHA256} */ (`${os}-${cpu}`);
	if (!SHA256[key]) throw new Error(`No pinned toxiproxy build for ${key}`);
	const name = `toxiproxy-server-${key}${os === "windows" ? ".exe" : ""}`;
	const dir = join(homedir(), ".cache", "prismalens", "toxiproxy", VERSION);
	const file = join(dir, name);
	const ok = (/** @type {Buffer} */ b) =>
		createHash("sha256").update(b).digest("hex") === SHA256[key];
	if (existsSync(file) && ok(readFileSync(file))) return file;
	const url = `https://github.com/Shopify/toxiproxy/releases/download/v${VERSION}/${name}`;
	console.log(`Downloading ${url}`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} → ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	if (!ok(bytes)) throw new Error(`${name} does not match its pinned sha256`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, bytes);
	chmodSync(file, 0o755);
	return file;
}

/** @param {string} path @param {{ method?: string, body?: unknown }} [init] */
async function admin(path, init = {}) {
	const res = await fetch(`${ADMIN}${path}`, {
		method: init.method ?? "GET",
		headers: { "content-type": "application/json" },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	const text = await res.text();
	if (!res.ok && res.status !== 404)
		throw new Error(`toxiproxy ${path} → ${res.status}: ${text}`);
	return res.status === 404 ? null : text ? JSON.parse(text) : null;
}

async function adminUp() {
	return admin("/version")
		.then(() => true)
		.catch(() => false);
}

async function ensureServer() {
	if (await adminUp()) return;
	const bin = await serverBinary();
	const child = spawn(
		bin,
		["-host", "127.0.0.1", "-port", String(ADMIN_PORT)],
		{
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		},
	);
	child.unref();
	mkdirSync(STATE, { recursive: true });
	writeFileSync(join(STATE, "server.pid"), String(child.pid));
	for (let i = 0; i < 50 && !(await adminUp()); i++) await sleep(100);
	if (!(await adminUp())) throw new Error("toxiproxy did not start");
}

/** A proxy with the slow-link toxics: half the round trip each way, and each way's rate. */
async function shapedProxy(/** @type {string} */ name, listen, upstream) {
	await admin(`/proxies/${name}`, { method: "DELETE" });
	await admin("/proxies", {
		method: "POST",
		body: { name, listen, upstream, enabled: true },
	});
	const half = SLOW_LINK.rttMs / 2;
	for (const stream of ["downstream", "upstream"])
		await admin(`/proxies/${name}/toxics`, {
			method: "POST",
			body: {
				name: `latency-${stream}`,
				type: "latency",
				stream,
				attributes: { latency: half, jitter: 0 },
			},
		});
	// toxiproxy's bandwidth rate is KB/s.
	for (const [stream, kbps] of [
		["downstream", SLOW_LINK.downKbps],
		["upstream", SLOW_LINK.upKbps],
	])
		await admin(`/proxies/${name}/toxics`, {
			method: "POST",
			body: {
				name: `bandwidth-${stream}`,
				type: "bandwidth",
				stream,
				attributes: { rate: Math.round(Number(kbps) / 8) },
			},
		});
}

/**
 * Measures what the shaping does on a probe proxy with the same toxics in front of a
 * local TCP sink, without HTTP's framing: a 1-byte round trip, 400 KB down, 150 KB up.
 */
async function measure(/** @type {number} */ probePort) {
	const DOWN = 400_000;
	const UP = 150_000;
	// "p" echoes one byte, "d" answers DOWN bytes, "u" + UP bytes answers one byte.
	const sink = createServer((s) => {
		let need = 0;
		s.on("data", (c) => {
			if (need > 0) {
				need -= c.length;
				if (need <= 0) s.write("k");
				return;
			}
			const cmd = String.fromCharCode(c[0] ?? 0);
			if (cmd === "p") s.write("k");
			if (cmd === "d") s.write(Buffer.alloc(DOWN, 97));
			if (cmd === "u") {
				need = UP - (c.length - 1);
				if (need <= 0) s.write("k");
			}
		});
	});
	await new Promise((r) => sink.listen(0, "127.0.0.1", () => r(undefined)));
	const sinkPort = /** @type {import("node:net").AddressInfo} */ (
		sink.address()
	).port;
	await shapedProxy(PROBE, `127.0.0.1:${probePort}`, `127.0.0.1:${sinkPort}`);
	const c = connectTcp(probePort, "127.0.0.1");
	c.setNoDelay(true);
	await new Promise((r) => c.once("connect", r));
	const exchange = (/** @type {Buffer} */ out, /** @type {number} */ bytes) =>
		new Promise((r) => {
			const t = performance.now();
			let got = 0;
			const on = (/** @type {Buffer} */ d) => {
				got += d.length;
				if (got < bytes) return;
				c.off("data", on);
				r(performance.now() - t);
			};
			c.on("data", on);
			c.write(out);
		});
	const pings = [];
	for (let i = 0; i < 5; i++)
		pings.push(/** @type {number} */ (await exchange(Buffer.from("p"), 1)));
	const rttMs = /** @type {number} */ (pings.sort((a, b) => a - b)[2]);
	const downMs = /** @type {number} */ (await exchange(Buffer.from("d"), DOWN));
	const upMs = /** @type {number} */ (
		await exchange(Buffer.concat([Buffer.from("u"), Buffer.alloc(UP, 98)]), 1)
	);
	c.destroy();
	await admin(`/proxies/${PROBE}`, { method: "DELETE" });
	sink.close();
	// Each transfer pays one round trip besides its bytes.
	const kbps = (/** @type {number} */ bytes, /** @type {number} */ ms) =>
		Math.round((bytes * 8) / Math.max(1, ms - rttMs));
	return {
		rttMs: Math.round(rttMs),
		downKbps: kbps(DOWN, downMs),
		upKbps: kbps(UP, upMs),
	};
}

async function up() {
	const url = arg("--url");
	const target = arg("--target") ?? (url ? new URL(url).host : undefined);
	if (!target)
		throw new Error(
			"Pass --url <PrismaLens URL> or --target <host:port> of its UI.",
		);
	const port = Number(
		arg("--port") ?? process.env.PRISMALENS_SLOW_LINK_PORT ?? 3330,
	);
	// Loopback unless asked: listening on every interface makes Windows Firewall ask the operator.
	const host = arg("--host") ?? "127.0.0.1";
	await ensureServer();
	await shapedProxy(PROXY, `${host}:${port}`, target);
	const observed = await measure(
		Number(arg("--probe-port") ?? (await freePort())),
	);
	mkdirSync(STATE, { recursive: true });
	writeFileSync(
		STATE_FILE,
		JSON.stringify({ target, port, host, adminPort: ADMIN_PORT, observed }),
	);
	console.log(
		`Slow link on ${host}:${port} → ${target}: ${observed.rttMs} ms round trip, ${observed.downKbps} kbps down, ${observed.upKbps} kbps up.`,
	);
	console.log(
		host === "127.0.0.1"
			? "Open it from a browser on this machine; --host 0.0.0.0 opens it to the phone."
			: "Open it from any browser or the phone on the same network.",
	);
	stamp(
		{ ...observed, drops: 0 },
		{ ...observed, target, listen: `${host}:${port}` },
	);
}

async function drop() {
	const forS = Number(
		arg("--for") ?? /** @type {any} */ (SLOW_LINK.drops)?.[0]?.forS ?? 10,
	);
	if (!(await admin(`/proxies/${PROXY}`)))
		throw new Error("No slow link is up; run `up` first.");
	const t = performance.now();
	await admin(`/proxies/${PROXY}`, {
		method: "POST",
		body: { enabled: false },
	});
	console.log(`Link dropped for ${forS} s.`);
	await sleep(forS * 1000);
	await admin(`/proxies/${PROXY}`, { method: "POST", body: { enabled: true } });
	const droppedMs = Math.round(performance.now() - t);
	console.log("Link back.");
	const state = saved;
	stamp(
		{ ...state.observed, drops: 1, droppedMs },
		{
			...state.observed,
			target: state.target,
			listen: `${state.host}:${state.port}`,
			drops: 1,
			droppedMs,
		},
	);
}

async function down() {
	const pidFile = join(STATE, "server.pid");
	if (existsSync(pidFile)) {
		const pid = Number(readFileSync(pidFile, "utf8"));
		try {
			process.kill(pid);
			console.log(`Stopped toxiproxy ${pid}.`);
		} catch {
			console.log(`toxiproxy ${pid} was not running.`);
		}
	}
}

const commands = { up, drop, down };
const cmd = /** @type {keyof typeof commands} */ (process.argv[2]);
if (!commands[cmd]) {
	console.log(
		"Usage: slow-link-proxy.mjs up --target <host:port> [--port 3330] [--host 127.0.0.1]\n         --host 0.0.0.0 opts in to the local network, to walk on the phone\n       slow-link-proxy.mjs drop [--for 10]\n       slow-link-proxy.mjs down",
	);
	process.exitCode = cmd ? 1 : 0;
} else
	commands[cmd]().catch((e) => {
		console.error(e instanceof Error ? e.message : String(e));
		process.exitCode = 1;
	});
