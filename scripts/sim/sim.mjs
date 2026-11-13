#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// One simulated PrismaLens for every consumer (#1101): Playwright, CI, judges, lanes. `up`
// boots the app on free ports with the fake agents, puts it into each condition the profile
// selects (the registry's `stage`), starts the triggers and writes a sheet; `down` kills
// only what `up` recorded. Profiles and conditions are registry data, never flags here.
//   pnpm sim up [--profile bare|ci|all|<condition>] [--only a,b] [--ref <branch>] [--mode packed|dev]
//   pnpm sim down
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
import { freePort } from "../fakes/conditions/lib.mjs";
import { installFakeAgent } from "../fakes/fake-acp-agent.mjs";
import { liveLinks, renderSheet, runLine } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SIM = resolve(process.env.PRISMALENS_SIM_DIR ?? join(ROOT, ".sim"));
const STATE = join(SIM, "state.json");
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
 * @typedef {{ id: string, simulator: { id: string, api?: string }, stage?: { run: string, live: string }, trigger?: { run: string, on: "schedule" | "button", atS?: number | "mid" }, walks: string[] }} SimCondition
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

/** Polls until `url` answers 2xx. */
async function ready(/** @type {string} */ url, timeoutMs) {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		const ok = await fetch(url)
			.then((r) => r.ok)
			.catch(() => false);
		if (ok) return;
		await sleep(1000);
	}
	throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

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
	return child.pid;
}

/** Boots the shipped artifact through scripts/pl-up-e2e.mjs, on one port. */
async function bootPacked(env, pids) {
	const port = await freePort();
	const prefix = join(SIM, "prefix");
	rmSync(prefix, { recursive: true, force: true });
	mkdirSync(prefix, { recursive: true });
	background(
		"app",
		process.execPath,
		[join(ROOT, "scripts/pl-up-e2e.mjs")],
		{ ...env, PL_UP_PORT: String(port), PL_UP_PREFIX: prefix },
		pids,
	);
	const url = `http://127.0.0.1:${port}`;
	log(`packing and booting pl up on ${url} (logs/app.log)`);
	await ready(`${url}/health`, 900_000);
	return { url, workspace: join(prefix, "workspace") };
}

/** Starts the API and Vite from this checkout, as the dev loop runs them. */
async function bootDev(env, pids, foreground) {
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
		[
			"ui",
			"pnpm",
			["--filter", "@prismalens/frontend", "dev", "--strictPort"],
			ROOT,
		],
	];
	if (foreground) {
		// Playwright owns these: they share its process group and print to its pipe. Ready is
		// each server's own line, never a URL probe, which can hang under WSL2 (playwright.config.ts).
		const want = { api: /API running on/, ui: /Local:/ };
		/** @type {Set<string>} */
		const seen = new Set();
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
					shell: cmd === "pnpm",
				},
			);
			c.stdout.on("data", (d) => {
				process.stdout.write(d);
				const key = /** @type {"api" | "ui"} */ (name);
				if (want[key].test(String(d))) seen.add(key);
				if (seen.size === 2) allSeen();
			});
			c.stderr.on("data", (d) => process.stderr.write(d));
			c.on("exit", (code) => {
				log(`${name} exited with ${code}`);
				process.exit(code ?? 1);
			});
			return c;
		});
		const stop = () => {
			for (const c of children) if (c.pid) killTree(c.pid);
		};
		process.on("exit", stop);
		for (const sig of ["SIGINT", "SIGTERM"])
			process.on(sig, () => {
				stop();
				process.exit(143);
			});
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
	execFileSync("git", ["fetch", "-q", "origin", ref], {
		cwd: ROOT,
		stdio: "inherit",
	});
	if (existsSync(dir))
		execFileSync(
			"git",
			["-C", dir, "checkout", "-q", "--detach", `origin/${ref}`],
			{
				stdio: "inherit",
			},
		);
	else
		execFileSync(
			"git",
			["worktree", "add", "-q", "--detach", dir, `origin/${ref}`],
			{
				cwd: ROOT,
				stdio: "inherit",
			},
		);
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
		pids,
		started: new Date(started).toISOString(),
	};
	const save = (/** @type {Record<string, unknown>} */ more = {}) => {
		if (!foreground)
			writeFileSync(STATE, JSON.stringify({ ...state, ...more }, null, "\t"));
	};
	save();
	const booted =
		mode === "dev"
			? await bootDev(env, pids, foreground)
			: { ...(await bootPacked(env, pids)), env: undefined };
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
else if (cmd === "sheet" && existsSync(join(SIM, "sheet.md")))
	console.log(readFileSync(join(SIM, "sheet.md"), "utf8"));
else {
	console.log(
		"Usage: pnpm sim up [--profile bare|ci|all|<condition>] [--only a,b] [--ref <branch>] [--mode packed|dev] [--foreground]\n       pnpm sim down\n       pnpm sim sheet",
	);
	process.exitCode = cmd ? 1 : 0;
}
