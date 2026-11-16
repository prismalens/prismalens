#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop beside npm's launcher (#717), run for real: the app's own backend stops
 * gracefully over IPC; a workspace a nightly migrated gets the newer-database dialog; and
 * the app attaches to a `pl up` the launcher started from a release mirror.
 *
 *   node scripts/launcher-proofs.mjs <standalone-archive> <launcher.tgz>
 * Needs `pnpm --filter @prismalens/desktop dist` first (the unpacked app and dist/).
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { readWorkspaceLockState } from "@prismalens/config";
import { startBackend, stopBackend, waitForHealth } from "../dist/backend.js";
import {
	appendTail,
	backendSpawn,
	backendUrl,
	planLaunch,
	stopDialog,
} from "../dist/supervisor.js";

const [archive, launcherTgz] = process.argv.slice(2).map((p) => resolve(p));
const here = new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const unpacked = join(here, "..", "release", "win-unpacked");
const app = {
	execPath: join(unpacked, "PrismaLens.exe"),
	backendMain: join(
		unpacked,
		"resources",
		"prismalens.asar",
		"prismalens",
		"dist",
		"bin",
		"prismalens.js",
	),
};
const scratch = mkdtempSync(join(tmpdir(), "pl-desktop-launcher-"));
let failed = 0;
// Nest re-raises the stop signal; Windows reports that as exit 1, POSIX as 143. Before stopBackend's 12s kill either way.
const graceful = (code, ms) =>
	code === (process.platform === "win32" ? 1 : 143) && ms < 12_000;
const check = (ok, what) => {
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const freePort = () =>
	new Promise((r) => {
		const s = createServer().listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => r(port));
		});
	});
const exited = (child) =>
	new Promise((r) => child.once("exit", (code, signal) => r({ code, signal })));
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const workspace = (name) => {
	const dir = join(scratch, name);
	mkdirSync(dir);
	return dir;
};

async function ownBackendStopsGracefully() {
	const ws = workspace("own");
	const port = await freePort();
	const child = startBackend(
		backendSpawn({ ...app, port, workspaceDir: ws, env: process.env }),
	);
	const up = await waitForHealth(`http://127.0.0.1:${port}`, 90_000);
	check(up, `the app's own backend answers /health on ${port}`);
	const lock = readWorkspaceLockState(ws);
	check(
		lock.kind === "held" && lock.owner.pid === child.pid,
		"its pid holds the workspace lock",
	);
	const started = Date.now();
	stopBackend(child);
	const { code } = await exited(child);
	const ms = Date.now() - started;
	check(
		graceful(code, ms),
		`LAUNCHER_STOP_MESSAGE ends it through the shutdown hooks (exit ${code} in ${ms}ms)`,
	);
	check(readWorkspaceLockState(ws).kind !== "held", "the lock is released");
}

async function newerDatabaseNamesTheMigration() {
	const ws = workspace("nightly-migrated");
	const db = new DatabaseSync(join(ws, "prismalens.db"));
	db.exec(
		'CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER NOT NULL DEFAULT 0)',
	);
	db.prepare(
		'INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES (?,?,CURRENT_TIMESTAMP,?,1)',
	).run("1", "x", "20991231000000_from_a_nightly");
	db.close();
	const child = startBackend(
		backendSpawn({
			...app,
			port: await freePort(),
			workspaceDir: ws,
			env: process.env,
		}),
	);
	let tail = [];
	child.stderr.on("data", (c) => {
		tail = appendTail(tail, c.toString("utf8"));
	});
	const { code } = await exited(child);
	const dialog = stopDialog({ owned: true, code, stderrTail: tail });
	console.log(`     dialog: ${dialog.message} | ${dialog.detail}`);
	check(
		dialog.kind === "newer-database",
		`a workspace a nightly migrated shows the newer-database dialog (exit ${code})`,
	);
	check(
		/this build does not ship \(20991231000000_from_a_nightly\)/.test(
			dialog.detail,
		),
		"the dialog names the migration the bundled runtime lacks",
	);
}

function mirror() {
	const root = join(scratch, "mirror");
	const name = basename(archive);
	const version = /^prismalens-(.+)-win32-x64\.zip$/.exec(name)[1];
	mkdirSync(join(root, `v${version}`), { recursive: true });
	copyFileSync(archive, join(root, `v${version}`, name));
	const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
	writeFileSync(join(root, `v${version}`, "SHA256SUMS"), `${sha}  ${name}\n`);
	return pathToFileURL(root).href;
}

function installLauncher() {
	const prefix = join(scratch, "prefix");
	execFileSync(
		"cmd.exe",
		[
			"/d",
			"/c",
			"npm",
			"install",
			"-g",
			"--prefix",
			prefix,
			"--no-audit",
			"--no-fund",
			launcherTgz,
		],
		{ stdio: "ignore" },
	);
	return join(
		prefix,
		"node_modules",
		"prismalens",
		"dist",
		"bin",
		"prismalens.js",
	);
}

async function attachesToTheLaunchersBackend(launcher, env) {
	const ws = workspace("attach");
	const port = await freePort();
	const pl = spawn(
		process.execPath,
		[
			launcher,
			"up",
			"--port",
			String(port),
			"--host",
			"127.0.0.1",
			"--no-open",
			"--workspace",
			ws,
		],
		{ env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
	);
	let lock = readWorkspaceLockState(ws);
	for (let i = 0; i < 600 && lock.kind !== "held"; i++) {
		await new Promise((r) => setTimeout(r, 250));
		lock = readWorkspaceLockState(ws);
	}
	const plan = planLaunch({
		lock,
		service: null,
		ownsWorkspace: true,
		storedPort: port,
		protocol: "http",
	});
	check(
		plan.kind === "attach" && plan.target.port === port,
		`the app plans to attach to the launcher's pl up on ${port}`,
	);
	check(
		plan.kind === "attach" && plan.pid !== pl.pid && alive(plan.pid),
		`the lock holder is the runtime (pid ${plan.pid}), not the launcher (pid ${pl.pid})`,
	);
	check(
		await waitForHealth(backendUrl(plan.target), 30_000),
		"the attached backend answers /health",
	);
	return { pl, ws, runtimePid: plan.pid };
}

async function supervisedLauncherStopsGracefully(launcher, env) {
	const ws = workspace("supervised");
	const port = await freePort();
	const child = startBackend({
		command: process.execPath,
		args: [
			launcher,
			"up",
			"--port",
			String(port),
			"--host",
			"127.0.0.1",
			"--no-open",
			"--workspace",
			ws,
		],
		env,
	});
	check(
		await waitForHealth(`http://127.0.0.1:${port}`, 120_000),
		"a launcher started as the app's backend answers /health",
	);
	const { owner } = readWorkspaceLockState(ws);
	const started = Date.now();
	stopBackend(child);
	const { code } = await exited(child);
	const ms = Date.now() - started;
	await new Promise((r) => setTimeout(r, 1000));
	const orphan = owner && alive(owner.pid);
	check(
		graceful(code, ms) && !orphan,
		`LAUNCHER_STOP_MESSAGE through the launcher stops the runtime gracefully (launcher exit ${code} in ${ms}ms, runtime ${owner?.pid} ${orphan ? "STILL RUNNING" : "gone"})`,
	);
	check(readWorkspaceLockState(ws).kind !== "held", "the lock is released");
	if (orphan) process.kill(owner.pid);
}

await ownBackendStopsGracefully();
await newerDatabaseNamesTheMigration();
if (archive && launcherTgz) {
	const launcher = installLauncher();
	const env = {
		...process.env,
		PRISMALENS_RELEASE_BASE_URL: mirror(),
		PRISMALENS_LAUNCHER_DIR: join(scratch, "cache"),
	};
	const attached = await attachesToTheLaunchersBackend(launcher, env);
	await supervisedLauncherStopsGracefully(launcher, env);
	attached.pl.kill();
	await exited(attached.pl);
	if (alive(attached.runtimePid)) process.kill(attached.runtimePid);
	console.log(`     cache: ${readdirSync(join(scratch, "cache")).join(", ")}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
