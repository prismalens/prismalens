#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Cross-OS APP-BOOT smoke (issue #330): boot the packed `pl up` artifact from a
 * GLOBAL npm install and assert the application BEHAVES — on Linux, macOS and
 * Windows.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — a booting process is not a working app
 * ---------------------------------------------------------------------------
 * `scripts/cross-os-smoke.sh` drives the CLI on all three OSes (`--version`,
 * `status`, a `serve` round-trip) and never boots the application, so nothing
 * in the 3-OS matrix asserted R1's actual claim: a stranger runs
 * `npm i -g prismalens && pl up` and gets a working app.
 *
 * `scripts/packed-smoke.sh` does boot it and does assert behaviour — but only
 * on ubuntu, inside a node:24-slim container, from a LOCAL `file:` install.
 * The two things most likely to break first on an unfamiliar platform are
 * exactly the two it cannot speak to:
 *
 *   1. `better-sqlite3` is a native addon. Whether its prebuilt binding
 *      resolves from a GLOBAL install on macOS-arm64 and windows-x64 is a
 *      per-platform question that a Linux container cannot answer.
 *   2. Nest's static SPA fallback (`ServeStaticModule` + the `exclude` list in
 *      `packages/api/src/app.module.ts`) is single-origin serving with no
 *      proxy. If that path-exclusion contract regresses, either the page 404s
 *      or the catch-all shadows `/api` — and a shadowed API looks like a
 *      working app right up until someone clicks something.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, AND HOW EACH ONE CAN FAIL
 * ---------------------------------------------------------------------------
 * Every check below is written so that a plausible regression turns it red.
 * An assertion that cannot fail is worse than no assertion.
 *
 *   native binding   `better-sqlite3` is required and opened from the INSTALLED
 *                    package's own resolution root, before boot, so a missing
 *                    or ABI-mismatched `.node` reports itself instead of
 *                    surfacing as an unexplained boot failure 90s later.
 *   /health          200. Fails if the process never listens.
 *   static asset     `/` must be the SPA shell, and the first same-origin JS/CSS
 *                    it references must come back 200 with a NON-HTML
 *                    content-type. The content-type half is the load-bearing
 *                    half: when an asset goes missing, the SPA fallback answers
 *                    `200 text/html` with index.html, so status alone is not
 *                    evidence that anything was served.
 *   /api not shadowed  `/api` is JSON service info, `/api/nonexistent` is a
 *                    JSON 404 (not the SPA shell), and an AUTHENTICATED
 *                    `GET /api/incidents` returns 200 after a real first-run
 *                    setup + sign-in. A catch-all that swallowed `/api` turns
 *                    all three into `200 text/html`.
 *   SPA deep route   a client-side path with no controller returns the shell,
 *                    i.e. the fallback is still doing its job.
 *   fork             `pl up` forks an investigation child per run. One is
 *                    triggered so the shutdown assertion has something to leak.
 *   clean shutdown   after terminating the process group / tree, no process
 *                    observed under it survives, and the port is released.
 *
 * ---------------------------------------------------------------------------
 * NOTES ON PORTABILITY
 * ---------------------------------------------------------------------------
 * Node, not bash. Windows has no `setsid`, no process groups worth the name,
 * and git-bash's `ps` sees only MSYS processes — `packed-smoke.sh`'s
 * `kill -TERM -$pid` has no portable translation. Process control, tree
 * walking and HTTP all live here instead, where each platform gets the one
 * mechanism that actually works on it.
 *
 * `pl up` is booted as `node <installed-bin>.js up` rather than through the
 * `pl` shim. The shim IS asserted (`pl --version` through the global bin dir,
 * below) but it is a wrapper: on Windows it is a `.cmd` that spawns a second
 * process under cmd.exe, which buys nothing here and makes the shutdown
 * assertion measure cmd.exe's teardown instead of the app's.
 *
 * Usage: node scripts/cross-os-app-boot.mjs
 *   Expects `prismalens` to be installed globally already (`npm i -g <tgz>` or
 *   `npm i -g prismalens@<version>`) — the workflow does that step so the
 *   install itself is a distinct, attributable failure.
 *
 * Env:
 *   PL_APP_BOOT_PORT           port to bind (default: a free ephemeral port)
 *   PL_APP_BOOT_TIMEOUT        seconds to wait for /health (default 180)
 *   PL_APP_BOOT_GLOBAL_ROOT    override for `npm root -g`
 *   PL_APP_BOOT_GLOBAL_PREFIX  override for `npm prefix -g`
 */

import { execFileSync, spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIN = process.platform === "win32";
const BOOT_TIMEOUT_S = Number(process.env.PL_APP_BOOT_TIMEOUT ?? 180);
/** How long to wait for the investigation child to show up. */
const FORK_TIMEOUT_S = 120;

let failures = 0;
const ok = (name, detail = "") =>
	console.log(`    OK   ${name}${detail ? ` — ${detail}` : ""}`);
const bad = (name, detail) => {
	failures++;
	console.error(`    FAIL ${name} — ${detail}`);
};
const die = (message) => {
	console.error(`APP-BOOT FAIL: ${message}`);
	process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Locate the global install
// ---------------------------------------------------------------------------

/**
 * Run a `.cmd`/`.bat` shim (npm, pl) portably.
 *
 * Since Node 18.20, execFile refuses to launch a `.cmd` without a shell
 * (CVE-2024-27980). `shell: true` would fix that but concatenates argv into one
 * unquoted string, so it breaks the moment a path contains a space — and the
 * global npm prefix is exactly the kind of path that can. Going through
 * `cmd.exe /c` with the shim as a normal argument keeps Node's own quoting.
 */
function runShim(file, args) {
	return execFileSync(
		WIN ? "cmd.exe" : file,
		WIN ? ["/d", "/s", "/c", file, ...args] : args,
		{ encoding: "utf8", windowsHide: true },
	).trim();
}

const npmOut = (args) => runShim(WIN ? "npm.cmd" : "npm", args);

// `npm root -g` is the answer in CI. The overrides exist because npm masks
// anything in its own output that looks like a credential — a scratch prefix
// under a path containing a UUID comes back as `.../***/...`, i.e. a path that
// does not exist — which makes local reproduction impossible without them.
const globalRoot =
	process.env.PL_APP_BOOT_GLOBAL_ROOT || npmOut(["root", "-g"]);
const globalPrefix =
	process.env.PL_APP_BOOT_GLOBAL_PREFIX || npmOut(["prefix", "-g"]);
const pkgDir = join(globalRoot, "prismalens");
const pkgManifest = join(pkgDir, "package.json");

console.log("==> the global install is present");
if (!existsSync(pkgManifest)) {
	die(
		`prismalens is not installed globally: ${pkgManifest} does not exist ` +
			`(global root = ${globalRoot}). Override with PL_APP_BOOT_GLOBAL_ROOT ` +
			"/ PL_APP_BOOT_GLOBAL_PREFIX if npm reported a masked path.",
	);
}
const version = JSON.parse(readFileSync(pkgManifest, "utf8")).version;
console.log(`    ${pkgDir} (v${version})`);

// The bin shim npm wrote for a global install. This is what a user actually
// types; assert it exists and runs before bypassing it for boot.
const shim = WIN
	? join(globalPrefix, "pl.cmd")
	: join(globalPrefix, "bin", "pl");
if (!existsSync(shim)) die(`the global \`pl\` shim is missing at ${shim}`);
const shimVersion = runShim(shim, ["--version"]);
if (shimVersion !== version) {
	die(
		`\`pl --version\` printed '${shimVersion}', package.json says '${version}'`,
	);
}
ok("global `pl` shim", `${shim} -> ${shimVersion}`);

// ---------------------------------------------------------------------------
// Native binding — asserted explicitly, before boot
// ---------------------------------------------------------------------------
// This is the whole reason the app-boot job runs on three OSes. Doing it as its
// own step means a platform without a usable prebuild says so in one line,
// rather than as a migration failure buried in a boot log.

console.log(
	"==> better-sqlite3's native binding loads from the global install",
);
try {
	const probe = execFileSync(
		process.execPath,
		[
			"-e",
			[
				"const { createRequire } = require('node:module');",
				"const r = createRequire(process.argv[1]);",
				"const Database = r('better-sqlite3');",
				"const db = new Database(':memory:');",
				"db.exec('create table t (a integer)');",
				"db.prepare('insert into t values (?)').run(1);",
				"const n = db.prepare('select count(*) as n from t').get().n;",
				"db.close();",
				"if (n !== 1) throw new Error('sqlite returned ' + n);",
				"console.log(r('better-sqlite3/package.json').version);",
			].join(""),
			pkgManifest,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
	).trim();
	ok("better-sqlite3 opens an in-memory database", `v${probe}`);
} catch (error) {
	const detail = `${error.stderr ?? ""}${error.message ?? ""}`.trim();
	die(
		"better-sqlite3's native binding does not load from the global install " +
			`on ${process.platform}-${process.arch}. Every assertion below would ` +
			`fail for this one reason.\n${detail}`,
	);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function freePort() {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

/** Resolves when nothing is listening on `port`, rejects if the bind fails. */
async function portIsFree(port) {
	return await new Promise((resolve) => {
		const server = createServer();
		server.on("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	});
}

const port = Number(process.env.PL_APP_BOOT_PORT ?? (await freePort()));
const scratch = mkdtempSync(join(tmpdir(), "pl-app-boot-"));
const workspace = join(scratch, "workspace");
mkdirSync(workspace, { recursive: true });
const logPath = join(scratch, "up.log");
const base = `http://127.0.0.1:${port}`;

// Strip every inherited PRISMALENS_* key before setting our own. The workspace
// dir is the ONLY thing that keeps this run away from a developer's real
// ~/.prismalens database, so an inherited PRISMALENS_DB_URL or a stray
// PRISMALENS_WORKSPACE_DIR must not survive into the child.
const env = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !k.startsWith("PRISMALENS_")),
);
Object.assign(env, {
	PRISMALENS_WORKSPACE_DIR: workspace,
	PRISMALENS_HOST: "127.0.0.1",
	PRISMALENS_PORT: String(port),
	NODE_ENV: "production",
});

const binJs = join(pkgDir, "dist", "bin", "prismalens.js");
if (!existsSync(binJs))
	die(`the installed bin entrypoint is missing: ${binJs}`);

console.log(`==> pl up on ${base} (workspace ${workspace})`);
const logStream = createWriteStream(logPath);
const child = spawn(process.execPath, [binJs, "up"], {
	env,
	stdio: ["ignore", "pipe", "pipe"],
	// A new process group on POSIX so the forked investigation child can be
	// reached by one signal. Windows has no equivalent; `taskkill /T` walks the
	// parent/child table instead (see stopApp).
	detached: !WIN,
	windowsHide: true,
});
child.stdout.pipe(logStream);
child.stderr.pipe(logStream);

let childExit = null;
child.on("exit", (code, signal) => {
	childExit = { code, signal };
});
child.on("error", (error) => die(`failed to start ${binJs}: ${error.message}`));

const readLog = () => {
	try {
		return readFileSync(logPath, "utf8");
	} catch {
		return "";
	}
};
const dumpLog = (lines = 60) => {
	console.error("----- pl up log (tail) -----");
	console.error(readLog().split("\n").slice(-lines).join("\n"));
	console.error("----------------------------");
};

// ---------------------------------------------------------------------------
// Process-tree bookkeeping (for the orphan assertion)
// ---------------------------------------------------------------------------

/** [pid, ppid] for every process on the machine. */
function processTable() {
	const pairs = [];
	let out;
	try {
		if (WIN) {
			// `wmic` is gone from current Windows images; CIM is the supported path.
			// The script deliberately contains NO double quotes: Node escapes them
			// as \" on the command line, and powershell.exe's handling of that is
			// famously unreliable. `-join ' '` needs only single quotes, which pass
			// through untouched.
			out = execFileSync(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"Get-CimInstance Win32_Process | ForEach-Object { ($_.ProcessId, $_.ParentProcessId) -join ' ' }",
				],
				{ encoding: "utf8", windowsHide: true },
			);
		} else {
			out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {
				encoding: "utf8",
			});
		}
	} catch {
		return pairs;
	}
	for (const line of out.split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(\d+)$/);
		if (m) pairs.push([Number(m[1]), Number(m[2])]);
	}
	return pairs;
}

/** Every transitive child of `root`, per one snapshot of the process table. */
function descendantsOf(root) {
	const byParent = new Map();
	for (const [pid, ppid] of processTable()) {
		if (!byParent.has(ppid)) byParent.set(ppid, []);
		byParent.get(ppid).push(pid);
	}
	const found = new Set();
	const queue = [root];
	while (queue.length) {
		for (const pid of byParent.get(queue.pop()) ?? []) {
			if (found.has(pid)) continue;
			found.add(pid);
			queue.push(pid);
		}
	}
	return found;
}

const isAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means it exists and is not ours to signal — still alive.
		return error.code === "EPERM";
	}
};

/**
 * Every pid ever seen under `pl up`. POLLED rather than read once at teardown:
 * the investigation child reaches its terminal verdict in a couple of seconds,
 * so a single snapshot taken afterwards would find an empty set and leave the
 * orphan check unable to fail.
 *
 * Polling is confined to the fork phase, and starts only once the investigation
 * has been requested. `processTable` uses execFileSync, which BLOCKS the event
 * loop — on Windows each PowerShell CIM query costs hundreds of milliseconds,
 * and a sampler running through the HTTP section would be measuring the
 * assertions' own latency. Nothing forks before the fork phase, so sampling
 * earlier would only cost time to observe nothing.
 */
const seenDescendants = new Set();
const sample = () => {
	for (const pid of descendantsOf(child.pid)) seenDescendants.add(pid);
};
let sampler = null;
const startSampling = () => {
	if (sampler) return;
	sampler = setInterval(sample, WIN ? 750 : 200);
	sampler.unref();
};
const stopSampling = () => {
	if (sampler) clearInterval(sampler);
	sampler = null;
};

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

let stopped = false;
async function stopApp() {
	if (stopped) return { graceful: null };
	stopped = true;
	// Stop sampling BEFORE the kill: a snapshot that races the teardown would
	// record pids that were already exiting and report them as leaks.
	stopSampling();
	let graceful = null;

	if (WIN) {
		try {
			execFileSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} catch {
			// already gone
		}
	} else {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			// already gone
		}
		// A clean SIGTERM exit is part of the contract on POSIX: an app that has
		// to be SIGKILLed is an app that leaks whatever it was holding.
		for (let i = 0; i < 60 && childExit === null; i++) await sleep(250);
		graceful = childExit !== null;
		if (!graceful) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				// already gone
			}
		}
	}
	for (let i = 0; i < 40 && childExit === null; i++) await sleep(250);
	return { graceful };
}

let cleanedUp = false;
const cleanup = () => {
	if (cleanedUp) return;
	cleanedUp = true;
	stopSampling();
	// Best-effort, synchronous: this runs on the abnormal paths too.
	if (WIN) {
		try {
			execFileSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} catch {
			/* already gone */
		}
	} else {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	for (const pid of seenDescendants) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	// Never let housekeeping decide the exit code. This runs inside the `exit`
	// handler, and on Windows an open SQLite/log handle makes rmSync throw
	// EBUSY — which would turn an all-green run red for no reason at all. The
	// runner discards its temp dir anyway.
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch (error) {
		console.warn(`    (could not remove ${scratch}: ${error.message})`);
	}
};
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		cleanup();
		process.exit(130);
	});
}

// ---------------------------------------------------------------------------
// Wait for health
// ---------------------------------------------------------------------------

console.log(`==> waiting up to ${BOOT_TIMEOUT_S}s for ${base}/health`);
let healthy = false;
for (let i = 0; i < BOOT_TIMEOUT_S * 4 && !healthy; i++) {
	if (childExit !== null) {
		dumpLog();
		die(
			`pl up exited before it served /health (code ${childExit.code}, signal ${childExit.signal})`,
		);
	}
	try {
		const response = await fetch(`${base}/health`, {
			signal: AbortSignal.timeout(4000),
		});
		if (response.status === 200) healthy = true;
	} catch {
		// not listening yet
	}
	if (!healthy) await sleep(250);
}
if (!healthy) {
	dumpLog();
	die(`pl up did not serve /health within ${BOOT_TIMEOUT_S}s`);
}
ok("/health 200");

// #327's lesson: HTTP assertions were reported green for an artifact that never
// finished booting. /health alone can be answered by a half-registered app, so
// the route table is checked too. Nest colourises its logs, which puts ANSI
// escapes between the `[RouterExplorer]` tag and the message — match on
// `Mapped {` alone or the count is silently zero.
const routes = (readLog().match(/Mapped \{/g) ?? []).length;
if (routes < 100) {
	dumpLog();
	die(`pl up mapped ${routes} routes — it did not finish booting`);
}
ok("route table registered", `${routes} routes`);

if (readLog().includes("CORS enabled for origins")) {
	bad("single-origin serving", "the vestigial CORS allowlist is back");
}

// ---------------------------------------------------------------------------
// The HTTP contract
// ---------------------------------------------------------------------------

/**
 * Better Auth rejects a state-changing request that carries no Origin
 * (MISSING_OR_NULL_ORIGIN) — its CSRF floor. A browser always sends one; a bare
 * fetch does not. Same-origin, because under `pl up` that is the only origin
 * there is: `trustedOrigins` is built from the resolved loopback bind in
 * `auth.service.ts`, so no PRISMALENS_FRONTEND_URL is needed here.
 */
const json = (path, init) =>
	fetch(base + path, {
		...init,
		headers: {
			"content-type": "application/json",
			origin: base,
			...(init?.headers ?? {}),
		},
	});

const isHtml = (body) => /^\s*<(?:!doctype html|html)/i.test(body);

console.log("==> the site root is the dashboard, and its assets are served");
const root = await fetch(`${base}/`);
const rootBody = await root.text();
let assetPath = null;
if (root.status === 200 && isHtml(rootBody)) {
	ok("/ serves the SPA shell", `${rootBody.length} bytes`);
	// Take the asset reference from the shipped index.html rather than guessing
	// a build-tool-specific path: a Vite/Rolldown output rename must not quietly
	// turn this check into a no-op against a URL nothing ever requested.
	assetPath =
		[...rootBody.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
			.map((m) => m[1])
			.find(
				(url) =>
					url.startsWith("/") &&
					!url.startsWith("//") &&
					/\.(?:js|mjs|css)(?:\?|$)/i.test(url),
			) ?? null;
} else {
	bad("/", `status ${root.status}, body starts "${rootBody.slice(0, 80)}"`);
}

if (!assetPath) {
	bad(
		"static asset",
		"index.html references no same-origin .js/.css — nothing to prove the SPA build shipped",
	);
} else {
	const asset = await fetch(base + assetPath);
	const assetType = asset.headers.get("content-type") ?? "";
	const assetBody = await asset.text();
	// Status 200 is NOT sufficient. A missing asset falls through to the SPA
	// catch-all, which answers 200 text/html with index.html — so the
	// content-type and the body shape are what actually detect a missing file.
	if (asset.status !== 200) {
		bad(`static asset ${assetPath}`, `status ${asset.status}`);
	} else if (/text\/html/i.test(assetType) || isHtml(assetBody)) {
		bad(
			`static asset ${assetPath}`,
			`served the SPA fallback instead of the file (content-type ${assetType}) — the asset is missing from the package`,
		);
	} else if (assetBody.length === 0) {
		bad(`static asset ${assetPath}`, "served an empty body");
	} else {
		ok(
			`static asset ${assetPath}`,
			`${assetBody.length} bytes, content-type ${assetType}`,
		);
	}
}

console.log("==> the SPA catch-all did not shadow the API");
const info = await fetch(`${base}/api`);
const infoType = info.headers.get("content-type") ?? "";
info.status === 200 && infoType.includes("json")
	? ok("/api serves JSON service info")
	: bad("/api", `status ${info.status}, content-type ${infoType}`);

const missing = await fetch(`${base}/api/nonexistent`);
const missingType = missing.headers.get("content-type") ?? "";
missing.status === 404 && missingType.includes("application/json")
	? ok("/api/nonexistent 404 JSON")
	: bad(
			"/api/nonexistent",
			`status ${missing.status}, content-type ${missingType} — the catch-all is answering under /api`,
		);

const deep = await fetch(`${base}/incidents/no-such-client-route`);
const deepBody = await deep.text();
deep.status === 200 && isHtml(deepBody)
	? ok("SPA deep route falls back to the shell")
	: bad(
			"SPA deep route",
			`status ${deep.status}, body starts "${deepBody.slice(0, 60)}"`,
		);

console.log("==> an authenticated /api call succeeds after first-run setup");
const email = "app-boot@prismalens.test";
const password = "app-boot-password-12345";
let cookie = "";

const setup = await json("/api/setup", {
	method: "POST",
	body: JSON.stringify({ email, password, name: "Cross-OS App Boot" }),
});
if (setup.ok) ok("POST /api/setup", `status ${setup.status}`);
else
	bad(
		"POST /api/setup",
		`status ${setup.status}: ${(await setup.text()).slice(0, 200)}`,
	);

const signIn = await json("/api/auth/sign-in/email", {
	method: "POST",
	body: JSON.stringify({ email, password }),
});
const signInBody = await signIn.text();
const setCookie = signIn.headers.getSetCookie?.() ?? [];
if (signIn.status === 200 && setCookie.length > 0) {
	cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
	ok("POST /api/auth/sign-in/email 200 with a session cookie");
} else {
	bad(
		"sign-in",
		`status ${signIn.status}, cookies ${setCookie.length}, body ${signInBody.slice(0, 200)}`,
	);
}

const incidents = await fetch(`${base}/api/incidents`, { headers: { cookie } });
const incidentsType = incidents.headers.get("content-type") ?? "";
const incidentsBody = await incidents.text();
if (
	incidents.status === 200 &&
	incidentsType.includes("json") &&
	!isHtml(incidentsBody)
) {
	ok("authenticated GET /api/incidents 200 JSON");
} else {
	bad(
		"authenticated GET /api/incidents",
		`status ${incidents.status}, content-type ${incidentsType}, body starts "${incidentsBody.slice(0, 80)}"`,
	);
}

// ---------------------------------------------------------------------------
// The fork, and then a clean shutdown
// ---------------------------------------------------------------------------
// `pl up` forks an investigation child per run. Without one there is nothing
// for the shutdown assertion to catch leaking, so one is started here — which
// also makes this the first coverage of the fork path on macOS and Windows.

console.log("==> pl up forks an investigation child");
sample();
let forked = false;
if (!cookie) {
	bad("fork", "no session — cannot trigger an investigation");
} else {
	const created = await json("/api/incidents", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({ title: "cross-os app boot", severity: "low" }),
	});
	const createdBody = await created.text();
	if (!created.ok) {
		bad(
			"POST /api/incidents",
			`status ${created.status}: ${createdBody.slice(0, 200)}`,
		);
	} else {
		// Parse defensively. A 2xx whose body is not the expected shape — a proxy
		// page, a changed contract — would otherwise throw out of top-level await
		// and take the teardown, orphan, port and failure-summary assertions with
		// it, turning a specific regression into an unhandled rejection.
		let incidentId = null;
		try {
			incidentId = JSON.parse(createdBody).id ?? null;
		} catch {
			incidentId = null;
		}
		if (!incidentId) {
			bad(
				"POST /api/incidents",
				`2xx with no usable id in the body: ${createdBody.slice(0, 200)}`,
			);
		} else {
			startSampling();
			const started = await json(`/api/incidents/${incidentId}/investigate`, {
				method: "POST",
				headers: { cookie },
				body: "{}",
			});
			if (!started.ok) {
				bad(
					"POST /api/incidents/:id/investigate",
					`status ${started.status}: ${(await started.text()).slice(0, 200)}`,
				);
			} else {
				// The log marker is the race-free signal — the child can live for only a
				// couple of seconds, so a process-table poll alone would be flaky. The
				// poll still runs, because its job is to RECORD pids for the orphan
				// assertion, not to decide whether the fork happened.
				let diagnosed = false;
				for (let i = 0; i < FORK_TIMEOUT_S && !forked && !diagnosed; i++) {
					await sleep(1000);
					sample();
					const log = readLog();
					forked = log.includes('"context":"InvestigationRun"');
					if (/Cannot locate the investigation child entrypoint/.test(log)) {
						bad(
							"fork",
							"the worker entrypoint did not resolve inside the install",
						);
						diagnosed = true;
					} else if (/ERR_MODULE_NOT_FOUND/.test(log)) {
						const line = log
							.split("\n")
							.find((l) => l.includes("ERR_MODULE_NOT_FOUND"));
						bad("fork", `the child could not resolve a dependency: ${line}`);
						diagnosed = true;
					}
				}
				if (forked) {
					ok(
						"investigation child forked",
						`${seenDescendants.size} pid(s) observed`,
					);
				} else if (!diagnosed) {
					dumpLog();
					bad("fork", `no investigation child within ${FORK_TIMEOUT_S}s`);
				}
			}
		}
	}
}

console.log("==> shutdown leaves nothing behind");
sample();
const observed = [...seenDescendants];
// Without a pid to check, "no orphans" is a sentence, not an assertion. This
// also doubles as the process-level proof that the fork produced a real OS
// process on this platform, which no log line can give.
if (forked && observed.length === 0) {
	bad(
		"orphan check",
		"the log says a child forked but no pid was ever observed under pl up — the orphan assertion below has nothing to check",
	);
}
const { graceful } = await stopApp();

if (childExit === null) {
	bad("shutdown", "the pl up process was still alive after the kill");
} else if (!WIN && graceful === false) {
	bad("shutdown", "pl up ignored SIGTERM and had to be SIGKILLed");
} else {
	ok("pl up exited", WIN ? "taskkill /T" : `SIGTERM (graceful: ${graceful})`);
}

// Give the OS a moment to reap, then look for anything that outlived the tree.
let survivors = [];
for (let i = 0; i < 20; i++) {
	survivors = observed.filter(isAlive);
	if (survivors.length === 0) break;
	await sleep(500);
}
survivors.length === 0
	? ok(
			"no orphaned children",
			`${observed.length} descendant pid(s) observed, 0 alive`,
		)
	: bad(
			"orphaned children",
			`still alive after shutdown: ${survivors.join(", ")}`,
		);

// The port is the user-visible symptom of a leak: an orphan holding the
// listening socket makes the next `pl up` fail with EADDRINUSE.
(await portIsFree(port))
	? ok(`port ${port} released`)
	: bad(`port ${port}`, "still bound after shutdown");

if (failures > 0) {
	console.error(`\nAPP-BOOT FAIL: ${failures} assertion(s) failed`);
	process.exit(1);
}
console.log(
	`\nAPP-BOOT OK (prismalens ${version}, node ${process.version}, ${process.platform}-${process.arch})`,
);
