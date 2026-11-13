#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// One simulated PrismaLens for every consumer (#1101): Playwright, CI, walks, lanes. `up`
// boots the app on free ports with the fake agents, puts it into each condition the profile
// selects (the registry's `stage`), starts the triggers and writes a sheet; `down` kills
// only what `up` recorded. Profiles and conditions are registry data, never flags here.
//   pnpm sim up [--profile bare|ci|all|<condition>] [--only a,b] [--ref <branch|sha>] [--mode packed|built|dev] [--measure]
//   pnpm sim down
//   pnpm sim report [--base <dir|sha>] [--compare <old> <new>]   (scripts/sim/report.mjs)
import { execFileSync, execSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cpuLoad } from "../../packages/@prismalens/registry/src/stamp.ts";
import { freePort } from "../fakes/conditions/lib.mjs";
import { installFakeAgent } from "../fakes/fake-acp-agent.mjs";
import { liveLinks, renderSheet, runLine } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SIM = resolve(process.env.PRISMALENS_SIM_DIR ?? join(ROOT, ".sim"));
const STATE = join(SIM, "state.json");
// Colour codes, built from the escape byte so the source holds no control character.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const PRELOAD = pathToFileURL(
	join(ROOT, "scripts/fakes/conditions/api-preload.mjs"),
).href;

/** @param {string} name */
const opt = (name) => {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (/** @type {string} */ name) => process.argv.includes(name);
const sleep = (/** @type {number} */ ms) =>
	new Promise((r) => setTimeout(r, ms));
const log = (/** @type {string} */ m) => console.log(`[sim] ${m}`);

/**
 * @typedef {{ id: string, simulator: { id: string, api?: string }, stage?: { run: string, live: string }, probe?: { run: string }, trigger?: { run: string, on: "schedule" | "button", atS?: number | "mid" }, walks: string[] }} SimCondition
 */

/** The selected conditions, read from the registry. @returns {SimCondition[]} */
function selected(/** @type {string} */ profile, /** @type {string[]} */ only) {
	const out = execFileSync(
		process.execPath,
		[
			"packages/@prismalens/registry/src/cli.ts",
			"--config",
			"packages/frontend/registry.config.json",
			"profile",
			profile,
			"--json",
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
	const all = /** @type {SimCondition[]} */ (JSON.parse(out));
	return only.length ? all.filter((c) => only.includes(c.id)) : all;
}

/** Kills a process and everything it started. */
function killTree(/** @type {number} */ pid) {
	try {
		if (process.platform === "win32")
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
			});
		else process.kill(-pid, "SIGKILL");
		return true;
	} catch {
		try {
			process.kill(pid, "SIGKILL");
			return true;
		} catch {
			return false;
		}
	}
}

/** Polls until `url` answers 2xx; gives up at once if the process `pid` has exited. */
async function ready(/** @type {string} */ url, timeoutMs, pid = 0) {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (pid && !alive(pid))
			throw new Error(`the app exited before ${url} answered; see .sim/logs`);
		const ok = await fetch(url)
			.then((r) => r.ok)
			.catch(() => false);
		if (ok) return;
		await sleep(1000);
	}
	throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

function alive(/** @type {number} */ pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Writes the state file; `up` points it at its own state once it has one. */
let persist = () => {};

/** A detached child with its output in `<sim>/logs/<name>.log`; its pid is recorded. */
function background(
	/** @type {string} */ name,
	/** @type {string} */ cmd,
	/** @type {string[]} */ args,
	/** @type {Record<string, string | undefined>} */ env,
	/** @type {{ pid: number, what: string }[]} */ pids,
	cwd = ROOT,
) {
	mkdirSync(join(SIM, "logs"), { recursive: true });
	const fd = openSync(join(SIM, "logs", `${name}.log`), "a");
	const child = spawn(cmd, args, {
		cwd,
		env,
		detached: true,
		stdio: ["ignore", fd, fd],
		windowsHide: true,
	});
	child.unref();
	if (!child.pid) throw new Error(`could not start ${name}`);
	pids.push({ pid: child.pid, what: name });
	// Recorded at once, so a `down` during a long boot still finds it.
	persist();
	return child.pid;
}

/**
 * Children the caller (Playwright) owns through this process: they end with it, also on a
 * force-kill, which on Windows runs no exit handler.
 */
function ownChildren(/** @type {number[]} */ kids) {
	const stop = () => {
		for (const pid of kids) killTree(pid);
	};
	process.on("exit", stop);
	// A force-kill (Windows) runs no exit handler, so a watchdog outlives this process
	// and ends the servers once it is gone.
	spawn(
		process.execPath,
		[
			"-e",
			`const [sim,...kids]=process.argv.slice(1).map(Number);const t=setInterval(()=>{try{process.kill(sim,0)}catch{clearInterval(t);for(const k of kids)try{require("node:child_process").execFileSync(process.platform==="win32"?"taskkill":"kill",process.platform==="win32"?["/PID",String(k),"/T","/F"]:["-9",String(-k)],{stdio:"ignore"})}catch{}}},1000)`,
			String(process.pid),
			...kids.map(String),
		],
		{ detached: true, stdio: "ignore", windowsHide: true },
	).unref();
	for (const sig of ["SIGINT", "SIGTERM"])
		process.on(sig, () => {
			stop();
			process.exit(143);
		});
}

/**
 * Boots the shipped artifact through scripts/pl-up-e2e.mjs, on one port. A caller that set
 * PL_UP_PORT and PL_UP_PREFIX (Playwright's pl-up project) keeps them.
 */
async function bootPacked(env, pids, foreground) {
	const port = env.PL_UP_PORT ?? String(await freePort());
	const prefix = env.PL_UP_PREFIX ?? join(SIM, "prefix");
	if (!env.PL_UP_PREFIX) {
		rmSync(prefix, { recursive: true, force: true });
		mkdirSync(prefix, { recursive: true });
	}
	const full = { ...env, PL_UP_PORT: port, PL_UP_PREFIX: prefix };
	const script = join(ROOT, "scripts/pl-up-e2e.mjs");
	let app;
	if (foreground) {
		const c = spawn(process.execPath, [script], {
			cwd: ROOT,
			env: full,
			stdio: ["ignore", "inherit", "inherit"],
		});
		c.on("exit", (code) => process.exit(code ?? 1));
		app = c.pid ?? 0;
		ownChildren([app]);
	} else app = background("app", process.execPath, [script], full, pids);
	const url = `http://127.0.0.1:${port}`;
	log(`packing and booting pl up on ${url}`);
	await ready(`${url}/health`, 900_000, app);
	return { url, workspace: join(prefix, "workspace") };
}

/**
 * Production mode from this checkout: a `vite build` the API serves on its one port, as
 * `pl up` serves it, so no dev server re-optimizes mid-run. PRISMALENS_SIM_PREBUILT=1 skips
 * the build when the caller already made it (several stacks share one dist).
 */
async function bootBuilt(env, pids, foreground) {
	const dist = join(ROOT, "packages/frontend/dist/client");
	if (env.PRISMALENS_SIM_PREBUILT !== "1") {
		log("building the frontend for production");
		execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
			cwd: join(ROOT, "packages/frontend"),
			stdio: foreground ? "ignore" : "inherit",
		});
	}
	if (!existsSync(join(dist, "index.html")))
		throw new Error(`no built frontend at ${dist}; run vite build first`);
	const api = env.PRISMALENS_PORT ?? String(await freePort());
	const url = `http://localhost:${api}`;
	return bootDev(
		{
			...env,
			PRISMALENS_PORT: api,
			PRISMALENS_FRONTEND_URL: url,
			PRISMALENS_STATIC_DIR: dist,
		},
		pids,
		foreground,
		true,
	);
}

/** Starts the API and Vite from this checkout, as the dev loop runs them; `apiOnly` serves a build instead. */
async function bootDev(env, pids, foreground, apiOnly = false) {
	const api = env.PRISMALENS_PORT ?? String(await freePort());
	const ui = env.PRISMALENS_FRONTEND_PORT ?? String(await freePort());
	const url = env.PRISMALENS_FRONTEND_URL ?? `http://localhost:${ui}`;
	const workspace = env.PRISMALENS_WORKSPACE_DIR ?? join(SIM, "workspace");
	mkdirSync(workspace, { recursive: true });
	const full = {
		...env,
		PRISMALENS_PORT: api,
		PRISMALENS_FRONTEND_PORT: ui,
		PRISMALENS_FRONTEND_URL: url,
		PRISMALENS_CORS_ORIGIN: env.PRISMALENS_CORS_ORIGIN ?? url,
		PRISMALENS_WORKSPACE_DIR: workspace,
	};
	const lines = [
		["api", process.execPath, ["dist/src/main.js"], join(ROOT, "packages/api")],
		// Vite straight from node: through pnpm and a PATH shim, a tree kill missed it.
		[
			"ui",
			process.execPath,
			["node_modules/vite/bin/vite.js", "dev", "--strictPort"],
			join(ROOT, "packages/frontend"),
		],
	].filter(([name]) => !apiOnly || name === "api");
	if (foreground) {
		// Playwright owns these: they share its process group and print to its pipe. Ready is
		// each server's own line, never a URL probe, which can hang under WSL2 (playwright.config.ts).
		const want = { api: /API running on/, ui: /Local:/ };
		/** @type {Set<string>} */
		const seen = new Set();
		const tail = { api: "", ui: "" };
		/** @type {() => void} */
		let allSeen = () => {};
		const both = new Promise((r) => {
			allSeen = () => r(undefined);
		});
		const children = lines.map(([name, cmd, args, cwd]) => {
			const c = spawn(
				/** @type {string} */ (cmd),
				/** @type {string[]} */ (args),
				{
					cwd: /** @type {string} */ (cwd),
					env: full,
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			c.stdout.on("data", (d) => {
				process.stdout.write(d);
				const key = /** @type {"api" | "ui"} */ (name);
				// Colour codes split "Local:"; a ready line may also straddle two chunks.
				tail[key] = `${tail[key]}${String(d)}`.replace(ANSI, "").slice(-400);
				if (want[key].test(tail[key])) seen.add(key);
				if (seen.size === lines.length) allSeen();
			});
			c.stderr.on("data", (d) => process.stderr.write(d));
			c.on("exit", (code) => {
				log(`${name} exited with ${code}`);
				process.exit(code ?? 1);
			});
			return c;
		});
		ownChildren(children.flatMap((c) => (c.pid ? [c.pid] : [])));
		await both;
		return { url, workspace, env: full };
	} else
		for (const [name, cmd, args, cwd] of lines)
			background(
				/** @type {string} */ (name),
				/** @type {string} */ (cmd),
				/** @type {string[]} */ (args),
				full,
				pids,
				/** @type {string} */ (cwd),
			);
	await ready(`http://127.0.0.1:${api}/health`, 120_000);
	await ready(url, 120_000);
	return { url, workspace, env: full };
}

/** Builds `ref` in a fresh worktree and runs `up` there; this checkout only points at it. */
function upInWorktree(/** @type {string} */ ref) {
	const dir = join(
		ROOT,
		".claude",
		"worktrees",
		`sim-${ref.replace(/[^\w.-]/g, "-")}`,
	);
	// A commit is checked out as itself; a branch at its newest pushed head.
	const sha = /^[0-9a-f]{7,40}$/.test(ref);
	const at = sha ? ref : `origin/${ref}`;
	if (!sha)
		execFileSync("git", ["fetch", "-q", "origin", ref], {
			cwd: ROOT,
			stdio: "inherit",
		});
	if (existsSync(dir))
		execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", at], {
			stdio: "inherit",
		});
	else
		execFileSync("git", ["worktree", "add", "-q", "--detach", dir, at], {
			cwd: ROOT,
			stdio: "inherit",
		});
	log(`installing ${ref} in ${dir}`);
	execSync("pnpm install --frozen-lockfile", { cwd: dir, stdio: "inherit" });
	const args = process.argv
		.slice(2)
		.filter((a, i, all) => a !== "--ref" && all[i - 1] !== "--ref");
	mkdirSync(SIM, { recursive: true });
	writeFileSync(STATE, JSON.stringify({ delegate: dir }, null, "\t"));
	execFileSync(process.execPath, [join(dir, "scripts/sim/sim.mjs"), ...args], {
		cwd: dir,
		stdio: "inherit",
	});
}

async function up() {
	const ref = opt("--ref");
	if (ref) return upInWorktree(ref);
	// In the foreground the caller (Playwright) owns the stack, its PATH and its fakes.
	const foreground = flag("--foreground");
	if (!foreground && existsSync(STATE)) {
		log("a previous sim is recorded; taking it down first");
		down();
	}
	// Sampled before anything starts, so a report can tell an idle machine from a busy one.
	const loadPct = await cpuLoad(1000);
	const started = Date.now();
	const profile = opt("--profile") ?? "bare";
	const only = (opt("--only") ?? "").split(",").filter(Boolean);
	const mode = opt("--mode") ?? "packed";
	const conditions = selected(profile, only);
	if (!foreground) rmSync(SIM, { recursive: true, force: true });
	mkdirSync(join(SIM, "logs"), { recursive: true });

	const fakebin = join(SIM, "fakebin");
	const fakes = join(SIM, "fakes-state");
	mkdirSync(fakebin, { recursive: true });
	if (!foreground) installFakeAgent(fakebin, { mcp: true, stateDir: fakes });
	const api = [
		...new Set(
			conditions.flatMap((c) => (c.simulator.api ? [c.simulator.api] : [])),
		),
	];
	const run =
		process.env.PRISMALENS_RUN_ID ??
		`sim-${new Date().toISOString().replace(/[:.]/g, "-")}`;
	/** @type {Record<string, string | undefined>} */
	const env = {
		...process.env,
		PATH: foreground
			? process.env.PATH
			: `${fakebin}${delimiter}${process.env.PATH ?? ""}`,
		PRISMALENS_TELEMETRY: process.env.PRISMALENS_TELEMETRY ?? "off",
		PRISMALENS_RUN_ID: run,
		PRISMALENS_SIM_LOAD: String(loadPct),
		PRISMALENS_SIM_MODE: mode,
		PRISMALENS_SIM_PROFILE: profile,
		PRISMALENS_SIM_CONDITIONS: conditions.map((c) => c.id).join(","),
		PRISMALENS_STAMP_DIR: join(SIM, "stamps"),
		PRISMALENS_FAKES_STATE: fakes,
		PRISMALENS_CONDITIONS_STATE: join(SIM, "conditions"),
		PRISMALENS_SLOW_LINK_PORT: String(await freePort()),
		PRISMALENS_TOXIPROXY_PORT: String(await freePort()),
		...(api.length
			? {
					PRISMALENS_CONDITIONS: api.join(","),
					NODE_OPTIONS:
						`${process.env.NODE_OPTIONS ?? ""} --import ${PRELOAD}`.trim(),
				}
			: {}),
	};
	/** @type {{ pid: number, what: string }[]} */
	const pids = [];
	const state = {
		root: ROOT,
		profile,
		only,
		mode,
		run,
		loadPct,
		pids,
		started: new Date(started).toISOString(),
	};
	const save = (/** @type {Record<string, unknown>} */ more = {}) => {
		if (!foreground)
			writeFileSync(STATE, JSON.stringify({ ...state, ...more }, null, "\t"));
	};
	save();
	persist = () => save();
	const booted =
		mode === "dev"
			? await bootDev(env, pids, foreground)
			: mode === "built"
				? await bootBuilt(env, pids, foreground)
				: { ...(await bootPacked(env, pids, foreground)), env: undefined };
	save();
	/** @type {Record<string, string | undefined>} */
	const stageEnv = {
		...(booted.env ?? env),
		PRISMALENS_WORKSPACE_DIR: booted.workspace,
		// Stages are clients, never the server: the preload stays out of them.
		NODE_OPTIONS: process.env.NODE_OPTIONS,
	};
	const url = booted.url;
	log(`app ready on ${url}; staging ${conditions.length} condition(s)`);

	const rows = [];
	for (const c of conditions) {
		if (!c.stage) {
			rows.push({
				id: c.id,
				ok: false,
				ms: 0,
				links: [],
				live: "no stage",
				trigger: c.trigger,
			});
			continue;
		}
		const line = c.stage.run.replaceAll("{url}", url);
		log(`stage ${c.id}`);
		const r = runLine(line, stageEnv, join(SIM, "logs", `stage-${c.id}.log`));
		rows.push({
			id: c.id,
			ok: r.ok,
			ms: r.ms,
			links: liveLinks(r.out, url),
			live: c.stage.live,
			trigger: c.trigger,
			walks: c.walks,
		});
	}
	// The slow link's own state names its port and its server's pid.
	const linkState = join(SIM, "conditions", "slow-link");
	const slow = existsSync(join(linkState, "state.json"))
		? JSON.parse(readFileSync(join(linkState, "state.json"), "utf8"))
		: null;
	if (existsSync(join(linkState, "server.pid")))
		pids.push({
			pid: Number(readFileSync(join(linkState, "server.pid"), "utf8")),
			what: "toxiproxy",
		});
	const slowUrl = slow ? `http://${slow.host}:${slow.port}` : null;
	if (flag("--measure")) {
		const thread = rows.flatMap((r) => r.links)[0]?.split("/threads/")[1];
		for (const c of conditions) {
			if (!c.probe) continue;
			const line = c.probe.run
				.replaceAll("{url}", url)
				.replaceAll("{slowUrl}", slowUrl ?? url)
				.replaceAll("{thread}", thread ?? "");
			log(`probe ${c.id}`);
			const r = runLine(line, stageEnv, join(SIM, "logs", `probe-${c.id}.log`));
			if (!r.ok) log(`probe ${c.id} failed; see .sim/logs/probe-${c.id}.log`);
		}
	}

	const pair = foreground
		? null
		: (() => {
				try {
					const out = execSync(
						"pnpm --silent --filter prismalens dev pair --operator",
						{
							cwd: ROOT,
							env: stageEnv,
							encoding: "utf8",
						},
					);
					const token = out.match(/\/pair#([^\s#]+)/)?.[1];
					return token ? `${url}/pair#${token}` : null;
				} catch {
					return null;
				}
			})();
	const controlPort = await freePort();
	const sheet = {
		profile,
		run,
		url,
		slowUrl,
		pair,
		control: `http://127.0.0.1:${controlPort}`,
		stamps: join(SIM, "stamps"),
		rows,
		upMs: 0,
	};
	writeFileSync(join(SIM, "sheet.json"), JSON.stringify(sheet, null, "\t"));
	if (!foreground)
		background(
			"control",
			process.execPath,
			[join(ROOT, "scripts/sim/control.mjs"), join(SIM, "sheet.json")],
			{
				...stageEnv,
				SIM_CONTROL_PORT: String(controlPort),
				PRISMALENS_SIM_DIR: SIM,
			},
			pids,
		);
	sheet.upMs = Date.now() - started;
	writeFileSync(join(SIM, "sheet.json"), JSON.stringify(sheet, null, "\t"));
	save({ url, slowUrl, control: sheet.control });
	const md = renderSheet(sheet);
	writeFileSync(join(SIM, "sheet.md"), md);
	console.log(md);
	log(
		`sheet: ${join(SIM, "sheet.md")}; up took ${Math.round(sheet.upMs / 1000)} s`,
	);
	// The line Playwright waits for.
	if (foreground) console.log(`sim: ready ${url}`);
}

function down() {
	if (!existsSync(STATE)) {
		log("nothing recorded; nothing to take down");
		return;
	}
	const state = JSON.parse(readFileSync(STATE, "utf8"));
	if (state.delegate) {
		execFileSync(
			process.execPath,
			[join(state.delegate, "scripts/sim/sim.mjs"), "down"],
			{
				cwd: state.delegate,
				stdio: "inherit",
			},
		);
		rmSync(STATE, { force: true });
		return;
	}
	for (const { pid, what } of [...(state.pids ?? [])].reverse())
		log(`${killTree(pid) ? "stopped" : "already gone"}: ${what} (${pid})`);
	rmSync(STATE, { force: true });
}

const cmd = process.argv[2];
if (cmd === "up")
	up().catch((e) => {
		console.error(`[sim] ${e instanceof Error ? e.message : String(e)}`);
		process.exitCode = 1;
	});
else if (cmd === "down") down();
else if (cmd === "report")
	import("./report.mjs")
		.then((m) => m.main(process.argv.slice(3)))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((e) => {
			console.error(`[sim] ${e instanceof Error ? e.message : String(e)}`);
			process.exitCode = 2;
		});
else if (cmd === "sheet" && existsSync(join(SIM, "sheet.md")))
	console.log(readFileSync(join(SIM, "sheet.md"), "utf8"));
else {
	console.log(
		"Usage: pnpm sim up [--profile bare|ci|all|<condition>] [--only a,b] [--ref <branch|sha>] [--mode packed|built|dev] [--measure] [--foreground]\n       pnpm sim down\n       pnpm sim sheet\n       pnpm sim report [--stamps <dir>] [--out <dir>] [--base <dir|sha>] [--compare <old-sha> <new-sha> [--allow-noisy]]",
	);
	process.exitCode = cmd ? 1 : 0;
}
