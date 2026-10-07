#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The release gate's side checks (#673), scripted: what the walk proved by hand
 * in a second terminal. Each check gets its own throwaway HOME, workspace and
 * port, an agent-free PATH, and a minimal env (no keys or logins leak in).
 *
 *   telemetry  the first TTY `pl up` prints the usage-data notice and sends
 *              nothing; PRISMALENS_TELEMETRY=off, DO_NOT_TRACK=1, CI=1 and
 *              --telemetry=off each send nothing; the next plain start sends
 *              `install_active` (build, run_mode, UTC-midnight timestamp).
 *   update     no line until the newer release's SHA256SUMS exists; then the
 *              next TTY start prints `Run: pl upgrade` without asking again;
 *              non-TTY, CI, DO_NOT_TRACK and PRISMALENS_UPDATE_CHECK=off hide it.
 *   lock       a second `pl up` on the workspace is refused naming the holder's
 *              pid and port; SIGTERM exits 143 and removes the lock; the next
 *              boot takes it fresh.
 *   reset      reset-data and a starting investigation refuse each other
 *              (fake ACP agent holds the run), and the end state is empty.
 *   hosts      a Host off the allowlist is refused with the
 *              PRISMALENS_ALLOWED_HOSTS line; an IP literal pairs.
 *   upgrade    Verdaccio serves the tarball and a next-patch copy that exits
 *              on `up`; `pl upgrade --trial-seconds 60` under `pl service`
 *              rolls back and the reason holds no token. Needs a systemd user
 *              manager and no existing prismalens.service, else SKIP.
 *
 * PostHog and the GitHub releases endpoint are never reached: a preload
 * (NODE_OPTIONS=--import) points fetch() for those hosts at a local stub,
 * since neither URL has an env override.
 *
 * Usage: gate-side-checks.mjs [--tarball <path>] [--only telemetry,lock,...]
 *   With no --tarball, packs the built CLI (`pack-cli.mjs --skip-build`).
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { homedir, hostname, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { installFakeAgent } from "./fakes/fake-acp-agent.mjs";

// pnpm's npm_config_* would reach the npm we spawn as unknown-config warnings.
const CLEAN_ENV = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)),
);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const READY_MS = 120_000;
const AGENT_BINARIES = [
	"opencode",
	"claude",
	"claude-agent-acp",
	"codex",
	"codex-acp",
	"gemini",
	"cursor-agent",
];
const NOTICE = /Usage data: PrismaLens counts feature use/;
const READY = /It works once, for 15 minutes|Once it is listening/;

const { values: opts } = parseArgs({
	options: { tarball: { type: "string" }, only: { type: "string" } },
});

const root = mkdtempSync(join(tmpdir(), "pl-gate-side-"));
const procs = new Set();
const results = [];

class Skip extends Error {}
const log = (msg) => console.log(`[gate] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

// ---------- setup: tarball, install, stub, preload ----------

function findOrPackTarball() {
	if (opts.tarball) return resolve(opts.tarball);
	const out = join(root, "pack");
	log("packing the built CLI (pack-cli.mjs --skip-build)");
	execFileSync(
		"node",
		[join(ROOT, "scripts", "pack-cli.mjs"), "--skip-build", "--out", out],
		{ cwd: ROOT, env: CLEAN_ENV, stdio: ["ignore", "ignore", "inherit"] },
	);
	const found = readdirSync(out).find((f) => f.endsWith(".tgz"));
	if (!found) throw new Error(`no tarball produced in ${out}`);
	return join(out, found);
}

function npmInstall(prefix, spec, extraEnv = {}) {
	execFileSync(
		"npm",
		[
			"install",
			"--prefix",
			prefix,
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			spec,
		],
		{
			stdio: ["ignore", "ignore", "inherit"],
			env: { ...CLEAN_ENV, ...extraEnv },
		},
	);
}

/** Records PostHog captures and answers the GitHub release HEADs the update check makes. */
function startStub() {
	const state = {
		captures: [],
		githubHits: [],
		latest: null,
		sumsReady: false,
	};
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (d) => {
			body += d;
		});
		req.on("end", () => {
			if (req.url.startsWith("/posthog/")) {
				try {
					state.captures.push(JSON.parse(body));
				} catch {
					state.captures.push({ raw: body });
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end('{"status":"Ok"}');
				return;
			}
			if (req.url.startsWith("/github/")) {
				state.githubHits.push(req.url);
				if (req.url.endsWith("/releases/latest") && state.latest) {
					res.writeHead(302, {
						location: `https://github.com/prismalens/prismalens/releases/tag/v${state.latest}`,
					});
					res.end();
					return;
				}
				if (req.url.endsWith("/SHA256SUMS") && state.sumsReady) {
					res.writeHead(302, { location: "https://example.invalid/sums" });
					res.end();
					return;
				}
			}
			res.writeHead(404);
			res.end();
		});
	});
	return new Promise((r) =>
		server.listen(0, "127.0.0.1", () =>
			r({ server, state, url: `http://127.0.0.1:${server.address().port}` }),
		),
	);
}

function writePreload() {
	const file = join(root, "gate-preload.mjs");
	writeFileSync(
		file,
		`const stub = process.env.GATE_STUB_URL;
if (stub) {
	const real = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
		const url = new URL(raw);
		if (url.hostname.endsWith("posthog.com")) return real(stub + "/posthog" + url.pathname, init);
		if (url.hostname === "github.com" && url.pathname.startsWith("/prismalens/prismalens/releases"))
			return real(stub + "/github" + url.pathname, init);
		return real(input, init);
	};
}
`,
	);
	return pathToFileURL(file).href;
}

function freePort() {
	return new Promise((r, reject) => {
		const s = net.createServer();
		s.on("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => r(port));
		});
	});
}

function resolveOnPath(bin, pathEnv) {
	for (const dir of pathEnv.split(delimiter)) {
		if (dir && existsSync(join(dir, bin))) return join(dir, bin);
	}
	return null;
}

// ---------- per-check sandbox ----------

let ctx;

/** Throwaway HOME, workspace and agent-free PATH; a minimal env so no login or key leaks in. */
async function sandbox(name, { fakeAgent } = {}) {
	const dir = join(root, name);
	const home = join(dir, "home");
	const tools = join(dir, "tools");
	for (const d of [home, tools, join(home, ".claude"), join(home, ".codex")])
		mkdirSync(d, { recursive: true });
	for (const tool of ["node", "npm", "git"]) {
		const target =
			tool === "node"
				? process.execPath
				: resolveOnPath(tool, process.env.PATH);
		if (!target) throw new Error(`${tool} is not on PATH`);
		writeFileSync(join(tools, tool), `#!/bin/sh\nexec "${target}" "$@"\n`, {
			mode: 0o755,
		});
	}
	const stateDir = join(dir, "fake-agent-state");
	if (fakeAgent) installFakeAgent(tools, { session: fakeAgent, stateDir });
	const PATH = [tools, "/usr/bin", "/bin"].join(delimiter);
	const leaked = AGENT_BINARIES.filter(
		(b) => resolveOnPath(b, ["/usr/bin", "/bin"].join(delimiter)) !== null,
	);
	if (leaked.length) throw new Error(`agent binaries on /usr/bin: ${leaked}`);
	const env = {
		PATH,
		HOME: home,
		TERM: "xterm-256color",
		LANG: process.env.LANG ?? "C.UTF-8",
		TMPDIR: join(dir, "tmp"),
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_STATE_HOME: join(home, ".local", "state"),
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		CODEX_HOME: join(home, ".codex"),
		NODE_OPTIONS: `--import=${ctx.preload}`,
		GATE_STUB_URL: ctx.stub.url,
		PRISMALENS_HOST: "127.0.0.1",
	};
	mkdirSync(env.TMPDIR, { recursive: true });
	return {
		dir,
		env,
		stateDir,
		workspace: join(dir, "workspace"),
		port: await freePort(),
	};
}

/** `pl up` in its own process group; `tty` runs it under script(1) for a real terminal. */
function up(sb, { tty = false, env = {}, args = [], port = sb.port } = {}) {
	const argv = [
		ctx.bin,
		"up",
		"--port",
		String(port),
		"--workspace",
		sb.workspace,
		"--no-open",
		...args,
	];
	const quoted = argv.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(" ");
	const child = tty
		? spawn("script", ["-qfec", quoted, "/dev/null"], {
				env: { ...sb.env, ...env },
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			})
		: spawn(argv[0], argv.slice(1), {
				env: { ...sb.env, ...env },
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
	let out = "";
	child.stdout.on("data", (d) => {
		out += d;
	});
	child.stderr.on("data", (d) => {
		out += d;
	});
	const exited = new Promise((r) =>
		child.on("exit", (code, signal) => r({ code, signal })),
	);
	procs.add(child);
	exited.then(() => procs.delete(child));
	const handle = {
		child,
		base: `http://127.0.0.1:${port}`,
		exited,
		out: () => stripVTControlCharacters(out).replaceAll("\r", ""),
		async waitFor(pattern, ms = READY_MS) {
			const end = Date.now() + ms;
			while (Date.now() < end) {
				if (pattern.test(handle.out())) return true;
				if (child.exitCode !== null) return pattern.test(handle.out());
				await sleep(250);
			}
			return false;
		},
		async ready() {
			if (!(await handle.waitFor(READY))) {
				throw new Error(
					`pl up not ready: ${handle.out().slice(-1500) || "(no output)"}`,
				);
			}
			// The usage-data and update lines print right after the startup link.
			await sleep(1500);
		},
		async stop(signal = "SIGTERM") {
			if (child.exitCode !== null || child.signalCode !== null) return exited;
			try {
				process.kill(-child.pid, signal);
			} catch {}
			const done = await Promise.race([exited, sleep(30_000).then(() => null)]);
			if (done) return done;
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
			return exited;
		},
	};
	return handle;
}

function run(file, args, env) {
	return new Promise((r) =>
		execFile(file, args, { env, timeout: 120_000 }, (error, stdout, stderr) =>
			r({
				code: error ? (error.code ?? 1) : 0,
				out: stripVTControlCharacters(`${stdout}${stderr}`),
			}),
		),
	);
}

/** `pl pair --operator`, then POST /api/pairing/redeem: the cookie a browser would get. */
async function pairOperator(sb, base, address) {
	const args = ["pair", "--operator", "--workspace", sb.workspace];
	if (address) args.push("--address", address);
	const { code, out } = await run(ctx.bin, args, sb.env);
	const token = out.match(/\/pair#([^\s#]+)/)?.[1];
	assert(code === 0 && token, `pl pair --operator failed (${code}): ${out}`);
	const res = await fetch(`${base}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: JSON.stringify({ token, name: "gate side checks" }),
		signal: AbortSignal.timeout(10_000),
	});
	const cookie = (res.headers.getSetCookie?.() ?? [])
		.find((c) => c.startsWith("prismalens.device."))
		?.split(";")[0];
	assert(res.status === 200 && cookie, `redeem returned ${res.status}`);
	return cookie;
}

function api(base, cookie) {
	return async (path, init = {}) => {
		const res = await fetch(base + path, {
			...init,
			signal: AbortSignal.timeout(15_000),
			headers: {
				"content-type": "application/json",
				origin: base,
				cookie,
				...(init.headers ?? {}),
			},
		});
		const text = await res.text();
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
		return { status: res.status, body };
	};
}

const rows = (body) =>
	Array.isArray(body) ? body : (body?.data ?? body?.items ?? []);

/** Raw HTTP so the Host header is ours; fetch() will not set it. */
function rawPost(address, port, host, path, body) {
	return new Promise((r, reject) => {
		const req = http.request(
			{
				host: address,
				port,
				path,
				method: "POST",
				headers: { host, "content-type": "application/json" },
			},
			(res) => {
				let text = "";
				res.on("data", (d) => {
					text += d;
				});
				res.on("end", () => r({ status: res.statusCode, text }));
			},
		);
		req.on("error", reject);
		req.end(JSON.stringify(body));
	});
}

// ---------- checks ----------

async function checkTelemetry() {
	const sb = await sandbox("telemetry");
	const env = { PRISMALENS_UPDATE_CHECK: "off" };
	const sent = () => ctx.stub.state.captures.length;
	const before = sent();

	const first = up(sb, { tty: true, env });
	await first.ready();
	assert(NOTICE.test(first.out()), "first TTY start printed no usage notice");
	await sleep(2000);
	assert(sent() === before, `first start sent ${sent() - before} event(s)`);
	await first.stop();

	const overrides = [
		["PRISMALENS_TELEMETRY=off", { PRISMALENS_TELEMETRY: "off" }, []],
		["DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }, []],
		["CI=1", { CI: "1" }, []],
		["--telemetry=off", {}, ["--telemetry", "off"]],
	];
	for (const [label, extra, args] of overrides) {
		const p = up(sb, { tty: true, env: { ...env, ...extra }, args });
		await p.ready();
		await sleep(2000);
		assert(sent() === before, `${label} start still sent an event`);
		assert(!NOTICE.test(p.out()), `${label} start printed the notice again`);
		await p.stop();
	}

	const next = up(sb, { tty: true, env });
	await next.ready();
	let active;
	for (let i = 0; i < 40 && !active; i++) {
		active = ctx.stub.state.captures
			.slice(before)
			.find((c) => c.event === "install_active");
		if (!active) await sleep(250);
	}
	assert(active, "second plain start sent no install_active");
	const p = active.properties ?? {};
	assert(p.build === "release", `install_active build=${p.build}`);
	assert(p.run_mode === "npm", `install_active run_mode=${p.run_mode}`);
	assert(
		/T00:00:00\.000Z$/.test(active.timestamp ?? ""),
		`install_active timestamp=${active.timestamp}`,
	);
	assert(!NOTICE.test(next.out()), "second start printed the notice again");
	const call = api(next.base, await pairOperator(sb, next.base));
	const settings = await call("/api/settings/telemetry");
	const recent = (settings.body?.recentlySent ?? []).map(
		(e) => e.payload?.event,
	);
	assert(
		recent.includes("install_active"),
		`Recently sent lacks install_active: ${JSON.stringify(recent)}`,
	);
	await next.stop();
	return `notice on 1st start, 0 sent; 4 overrides sent 0; next start sent install_active (build=release, run_mode=npm, ts=${active.timestamp}); Recently sent shows it`;
}

async function checkUpdate() {
	const sb = await sandbox("update");
	const cache = join(sb.workspace, "update-check.json");
	const env = { PRISMALENS_TELEMETRY: "off" };
	const LINE =
		/prismalens 9\.9\.9 is available \(you have [^)]+\)\. Run: pl upgrade/;
	const stub = ctx.stub.state;
	stub.latest = "9.9.9";
	stub.sumsReady = false;
	try {
		const notReady = up(sb, { tty: true, env });
		await notReady.ready();
		await sleep(2000);
		await notReady.stop();
		const held = JSON.parse(readFileSync(cache, "utf8"));
		assert(
			held.latest === null && held.recheckAt,
			`SHA256SUMS missing, yet cache learned ${JSON.stringify(held)}`,
		);

		stub.sumsReady = true;
		rmSync(cache);
		const learn = up(sb, { tty: true, env });
		await learn.ready();
		for (let i = 0; i < 40 && !existsSync(cache); i++) await sleep(250);
		await learn.stop();
		assert(!LINE.test(learn.out()), "a cold cache printed the line");
		assert(
			JSON.parse(readFileSync(cache, "utf8")).latest === "9.9.9",
			"the cache did not learn 9.9.9",
		);

		const hits = stub.githubHits.length;
		const shows = up(sb, { tty: true, env });
		await shows.ready();
		await shows.stop();
		assert(
			LINE.test(shows.out()),
			`no update line: ${shows.out().slice(-600)}`,
		);
		assert(stub.githubHits.length === hits, "a fresh cache asked again");

		const hidden = [
			["non-TTY", false, {}],
			["CI=1", true, { CI: "1" }],
			["DO_NOT_TRACK=1", true, { DO_NOT_TRACK: "1" }],
			["PRISMALENS_UPDATE_CHECK=off", true, { PRISMALENS_UPDATE_CHECK: "off" }],
		];
		for (const [label, tty, extra] of hidden) {
			const p = up(sb, { tty, env: { ...env, ...extra } });
			await p.ready();
			await p.stop();
			assert(!LINE.test(p.out()), `${label} still printed the update line`);
		}
		return `held until SHA256SUMS existed; then "${shows.out().match(LINE)[0]}"; no re-ask inside 24 h; hidden under non-TTY, CI, DO_NOT_TRACK, PRISMALENS_UPDATE_CHECK=off`;
	} finally {
		stub.latest = null;
		stub.sumsReady = false;
	}
}

async function checkLock() {
	const sb = await sandbox("lock");
	const env = { PRISMALENS_TELEMETRY: "off", PRISMALENS_UPDATE_CHECK: "off" };
	const lockFile = join(sb.workspace, "prismalens.lock");
	const holder = up(sb, { env });
	await holder.ready();
	const holderPid = JSON.parse(readFileSync(lockFile, "utf8")).pid;

	const second = up(sb, { env, port: await freePort() });
	const { code } = await Promise.race([
		second.exited,
		sleep(60_000).then(() => ({ code: "timeout" })),
	]);
	await second.stop("SIGKILL");
	const refusal = second.out();
	assert(code !== 0 && code !== "timeout", `second pl up exit ${code}`);
	assert(
		refusal.includes(`pid ${holderPid}`) && refusal.includes(`port ${sb.port}`),
		`refusal does not name pid ${holderPid} port ${sb.port}: ${refusal.slice(-600)}`,
	);

	const stopped = await holder.stop("SIGTERM");
	// Nest re-raises the signal after its shutdown hooks, so a shell reads 128+15.
	const exit143 = stopped.code === 143 || stopped.signal === "SIGTERM";
	assert(exit143, `SIGTERM exit ${JSON.stringify(stopped)}`);
	assert(!existsSync(lockFile), "lock file left after SIGTERM");

	const next = up(sb, { env });
	await next.ready();
	const owner = JSON.parse(readFileSync(lockFile, "utf8"));
	assert(owner.pid !== holderPid, "next boot still shows the old pid");
	assert(!/stale/i.test(next.out()), "next boot reclaimed a stale lock");
	await next.stop();
	const line = refusal
		.split("\n")
		.find((l) => l.includes("Another PrismaLens process"))
		?.trim();
	return `refused: "${line?.slice(0, 110)}…"; SIGTERM exit 143, lock removed; next boot took a free lock`;
}

async function checkReset() {
	const sb = await sandbox("reset", { fakeAgent: "live" });
	const env = {
		PRISMALENS_TELEMETRY: "off",
		PRISMALENS_UPDATE_CHECK: "off",
		PRISMALENS_HARNESS: "opencode",
		PRISMALENS_PLACEMENT: "server",
	};
	const p = up(sb, { env });
	await p.ready();
	const call = api(p.base, await pairOperator(sb, p.base));
	const reset = () =>
		call("/api/settings/danger/reset-data", {
			method: "POST",
			body: JSON.stringify({ confirmation: "RESET" }),
		});
	const service = await call("/api/services", {
		method: "POST",
		body: JSON.stringify({ name: "gate-reset" }),
	});
	assert(service.status < 300, `POST /api/services ${service.status}`);
	const incident = async (title) => {
		const r = await call("/api/incidents", {
			method: "POST",
			body: JSON.stringify({ title, serviceId: service.body.id }),
		});
		assert(r.status < 300, `POST /api/incidents ${r.status}`);
		return r.body.id;
	};
	const investigate = (id) =>
		call(`/api/incidents/${id}/investigate`, { method: "POST", body: "{}" });
	const settle = async (investigationId) => {
		await call(`/api/investigations/${investigationId}/cancel`, {
			method: "POST",
			body: "{}",
		});
		for (let i = 0; i < 120; i++) {
			const s = await call(`/api/investigations/${investigationId}`);
			if (
				!["queued", "running", "pending"].includes(
					String(s.body?.status).toLowerCase(),
				)
			)
				return;
			await sleep(500);
		}
		throw new Error(`run ${investigationId} never left running`);
	};

	const held = await incident("gate reset: held run");
	const started = await investigate(held);
	assert(
		started.status < 300,
		`investigate ${started.status}: ${JSON.stringify(started.body).slice(0, 300)}`,
	);
	const refused = await reset();
	assert(
		refused.status === 409 &&
			/queued or running/.test(JSON.stringify(refused.body)),
		`reset during a run: ${refused.status} ${JSON.stringify(refused.body).slice(0, 300)}`,
	);
	const kept = await call(`/api/incidents/${held}`);
	assert(kept.status === 200, "the refused reset still deleted the incident");
	await settle(started.body.investigationId);

	const outcomes = [];
	// Staggered so both orders occur: a negative delay holds the reset back, a positive one the run.
	const delays = [-40, -10, -2, 0, 2, 10];
	for (const [round, delay] of delays.entries()) {
		const id = await incident(`gate reset: race ${round}`);
		const [rst, inv] = await Promise.all([
			sleep(Math.max(0, -delay)).then(reset),
			sleep(Math.max(0, delay)).then(() => investigate(id)),
		]);
		assert(
			inv.status < 500 && rst.status < 500,
			`5xx in race: ${inv.status}/${rst.status}`,
		);
		const ran = inv.status < 300;
		const wiped = rst.status < 300;
		assert(
			ran !== wiped,
			`race round ${round}: investigate ${inv.status}, reset ${rst.status}`,
		);
		outcomes.push(ran ? "run won" : `reset won (run ${inv.status})`);
		if (ran) await settle(inv.body.investigationId);
	}
	const final = await reset();
	assert(final.status === 200, `final reset ${final.status}`);
	const incidents = rows((await call("/api/incidents")).body);
	const investigations = rows((await call("/api/investigations")).body);
	assert(
		incidents.length === 0 && investigations.length === 0,
		`not clean: ${incidents.length} incidents, ${investigations.length} investigations`,
	);
	await p.stop();
	return `reset during a running run → 409 "queued or running", incident kept; ${delays.length} races (${outcomes.join(", ")}), no 5xx, never both; final reset leaves 0 incidents, 0 runs`;
}

async function checkHosts() {
	const sb = await sandbox("hosts");
	const env = { PRISMALENS_TELEMETRY: "off", PRISMALENS_UPDATE_CHECK: "off" };
	// A name that resolves to a loopback address other than "localhost" exercises the CLI's refusal.
	const name = hostname().toLowerCase();
	const addr = await lookup(name, { family: 4 }).catch(() => null);
	const bindHost = addr?.address?.startsWith("127.")
		? addr.address
		: "127.0.0.1";
	const p = up(sb, { env, args: ["--host", bindHost] });
	await p.ready();

	const evil = await rawPost(
		bindHost,
		sb.port,
		`gate-unlisted.invalid:${sb.port}`,
		"/api/pairing/redeem",
		{
			token: "x",
		},
	);
	assert(
		evil.status === 403 && evil.text.includes("PRISMALENS_ALLOWED_HOSTS"),
		`unlisted Host: ${evil.status} ${evil.text.slice(0, 200)}`,
	);
	const ip = await rawPost(
		bindHost,
		sb.port,
		`${bindHost}:${sb.port}`,
		"/api/pairing/redeem",
		{
			token: "x",
		},
	);
	assert(
		ip.status !== 403,
		`IP-literal Host refused: ${ip.text.slice(0, 200)}`,
	);

	let cli = "CLI half skipped: the hostname does not resolve to loopback";
	if (bindHost !== "127.0.0.1") {
		const r = await run(
			ctx.bin,
			[
				"pair",
				"--operator",
				"--workspace",
				sb.workspace,
				"--address",
				`http://${name}:${sb.port}`,
			],
			sb.env,
		);
		assert(
			r.code !== 0 && r.out.includes(`PRISMALENS_ALLOWED_HOSTS=${name}`),
			`pl pair --address ${name}: ${r.code} ${r.out.slice(-400)}`,
		);
		cli = `pl pair --address http://${name}:… refused with "PRISMALENS_ALLOWED_HOSTS=${name}"`;
	}
	const origin = `http://${bindHost}:${sb.port}`;
	await pairOperator(sb, origin, origin);
	await p.stop();
	return `Host gate-unlisted.invalid → 403 naming PRISMALENS_ALLOWED_HOSTS; ${cli}; IP literal ${bindHost} paired (redeem 200)`;
}

async function checkUpgrade() {
	const sysd = await run(
		"systemctl",
		["--user", "show-environment"],
		CLEAN_ENV,
	);
	if (sysd.code !== 0)
		throw new Skip(
			`no systemd user manager (systemctl --user: ${sysd.out.trim().split("\n")[0]}); pl upgrade only trials and rolls back under pl service, which needs one (sudo loginctl enable-linger $USER, then a login session)`,
		);
	const realConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const unit = join(realConfig, "systemd", "user", "prismalens.service");
	if (existsSync(unit))
		throw new Skip(
			`${unit} exists; refusing to replace the operator's service`,
		);
	const verdaccioOk = await run(
		"npx",
		["-y", "verdaccio@6", "--version"],
		CLEAN_ENV,
	);
	if (verdaccioOk.code !== 0)
		throw new Skip(`npx verdaccio unavailable: ${verdaccioOk.out.slice(-200)}`);

	const sb = await sandbox("upgrade");
	// The user manager reads units from the real config dir; everything else stays throwaway.
	const env = {
		...sb.env,
		XDG_CONFIG_HOME: realConfig,
		XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "",
		DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "",
		PRISMALENS_TELEMETRY: "off",
		PRISMALENS_UPDATE_CHECK: "off",
	};
	const regPort = await freePort();
	const registry = `http://127.0.0.1:${regPort}/`;
	const cfg = join(sb.dir, "verdaccio.yaml");
	writeFileSync(
		cfg,
		`storage: ${join(sb.dir, "storage")}
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  'prismalens':
    access: $all
    publish: $anonymous
  '**':
    access: $all
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
`,
	);
	const verdaccio = spawn(
		"npx",
		["-y", "verdaccio@6", "--config", cfg, "--listen", `127.0.0.1:${regPort}`],
		{ detached: true, stdio: "ignore", env: CLEAN_ENV },
	);
	procs.add(verdaccio);
	let up200 = false;
	for (let i = 0; i < 120 && !up200; i++) {
		up200 = await fetch(`${registry}-/ping`)
			.then((r) => r.ok)
			.catch(() => false);
		if (!up200) await sleep(500);
	}
	assert(up200, "verdaccio did not answer /-/ping");
	const npmrc = join(sb.dir, "npmrc");
	writeFileSync(
		npmrc,
		`registry=${registry}\n//127.0.0.1:${regPort}/:_authToken=gate-fake\n`,
	);
	const npmEnv = {
		...env,
		NPM_CONFIG_USERCONFIG: npmrc,
		NPM_CONFIG_REGISTRY: registry,
		NPM_CONFIG_PREFIX: join(sb.dir, "prefix"),
	};
	const current = JSON.parse(
		execFileSync("tar", ["-xzOf", ctx.tarball, "package/package.json"], {
			encoding: "utf8",
		}),
	).version;
	const [ma, mi, pa] = current.split(".").map(Number);
	const next = `${ma}.${mi}.${pa + 1}`;
	const token = "G".repeat(43);
	const bad = join(sb.dir, "bad");
	mkdirSync(bad, { recursive: true });
	execFileSync("tar", ["-xzf", ctx.tarball, "-C", bad]);
	const pkgDir = join(bad, "package");
	const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
	pkg.version = next;
	writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2));
	for (const binPath of new Set(Object.values(pkg.bin))) {
		writeFileSync(
			join(pkgDir, binPath),
			`#!/usr/bin/env node
if (process.argv.includes("up")) {
	console.log("Open: http://127.0.0.1:1/pair#${token}");
	console.error("error: gate-side-checks fake ${next} refuses to start token=${token}");
	process.exit(1);
}
console.log("${next}");
`,
			{ mode: 0o755 },
		);
	}
	const badTgz = execFileSync("npm", ["pack", "--pack-destination", sb.dir], {
		cwd: pkgDir,
		env: npmEnv,
		encoding: "utf8",
	})
		.trim()
		.split("\n")
		.at(-1);
	for (const tgz of [ctx.tarball, join(sb.dir, badTgz)]) {
		execFileSync("npm", ["publish", tgz, "--tag", "latest"], {
			env: npmEnv,
			stdio: ["ignore", "ignore", "inherit"],
		});
	}
	execFileSync(
		"npm",
		["install", "-g", `prismalens@${current}`, "--no-audit", "--no-fund"],
		{
			env: npmEnv,
			stdio: ["ignore", "ignore", "inherit"],
		},
	);
	const pl = join(npmEnv.NPM_CONFIG_PREFIX, "bin", "pl");
	const port = await freePort();
	try {
		const inst = await run(
			pl,
			[
				"service",
				"install",
				"--workspace",
				sb.workspace,
				"--port",
				String(port),
			],
			npmEnv,
		);
		assert(inst.code === 0, `pl service install: ${inst.out.slice(-400)}`);
		const upgrade = await run(
			pl,
			["upgrade", "--version", next, "--trial-seconds", "60"],
			npmEnv,
		);
		assert(upgrade.code !== 0, `upgrade to the broken ${next} succeeded`);
		assert(
			/didn't come up/.test(upgrade.out),
			`no rollback line: ${upgrade.out.slice(-600)}`,
		);
		const status = await run(pl, ["service", "status"], npmEnv);
		const line =
			status.out
				.split("\n")
				.find((l) => l.includes("Upgrade:"))
				?.trim() ?? "";
		assert(
			/rolled back to/.test(line),
			`service status Upgrade line: ${line || status.out.slice(-400)}`,
		);
		assert(
			!`${upgrade.out}${line}`.includes(token),
			"the reason line carries the pairing token",
		);
		const version = await run(pl, ["--version"], npmEnv);
		assert(
			version.out.includes(current),
			`pl --version after rollback: ${version.out}`,
		);
		return `${current} → ${next} rolled back; "${line.slice(0, 140)}"; no token in the reason`;
	} finally {
		await run(pl, ["service", "uninstall"], npmEnv);
	}
}

const CHECKS = [
	["telemetry", checkTelemetry],
	["update", checkUpdate],
	["lock", checkLock],
	["reset", checkReset],
	["hosts", checkHosts],
	["upgrade", checkUpgrade],
];

function cleanup() {
	for (const child of procs) {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
	}
	ctx?.stub?.server.close();
	rmSync(root, { recursive: true, force: true });
}
process.on("SIGINT", () => {
	cleanup();
	process.exit(130);
});
process.on("SIGTERM", () => {
	cleanup();
	process.exit(143);
});

async function main() {
	const only = opts.only?.split(",");
	const tarball = findOrPackTarball();
	const prefix = join(root, "prefix");
	log(`installing ${tarball}`);
	npmInstall(prefix, tarball);
	const bin = join(prefix, "node_modules", ".bin", "pl");
	assert(existsSync(bin), `pl not linked at ${bin}`);
	ctx = { tarball, bin, stub: await startStub(), preload: writePreload() };
	for (const [name, fn] of CHECKS) {
		if (only && !only.includes(name)) continue;
		const t0 = Date.now();
		log(`${name}: running`);
		try {
			const detail = await fn();
			results.push(["PASS", name, detail, t0]);
		} catch (e) {
			results.push([e instanceof Skip ? "SKIP" : "FAIL", name, e.message, t0]);
		} finally {
			for (const child of procs) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			}
		}
		const [status, , detail] = results.at(-1);
		log(
			`${name}: ${status} (${Math.round((Date.now() - t0) / 1000)}s)${status === "FAIL" ? ` ${detail}` : ""}`,
		);
	}
	console.log("");
	for (const [status, name, detail] of results)
		console.log(`${status.padEnd(4)} ${name.padEnd(9)} ${detail}`);
	return results.some(([s]) => s === "FAIL") ? 1 : 0;
}

main()
	.then((code) => {
		cleanup();
		process.exit(code);
	})
	.catch((e) => {
		console.error(`gate-side-checks: ${e?.stack ?? e}`);
		cleanup();
		process.exit(1);
	});
