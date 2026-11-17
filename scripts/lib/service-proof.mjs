#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// `pl service` on a real systemd user manager, installed through the npm launcher (#732, #717):
// the unit runs the launcher, verifies, follows a channel switch across restarts, and a SIGTERM
// to the launcher alone or to the whole cgroup reaches the API exactly once and shuts it down clean.
//   node scripts/lib/service-proof.mjs <dir-with-app-tarball>
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	nightlyAfter,
	prepareLauncher,
	tarballVersion,
} from "./launcher-mirror.mjs";

const UNIT = "prismalens.service";
const PORT = 3190;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (m) => console.log(`[service] OK   ${m}`);
function check(cond, msg) {
	if (!cond) throw new Error(msg);
}

const dir = resolve(process.argv[2] ?? "");
const tgzName = readdirSync(dir).find((f) =>
	/^prismalens-[0-9].*\.tgz$/.test(f),
);
if (!tgzName) throw new Error(`no prismalens-*.tgz in ${dir}`);
const tgz = join(dir, tgzName);
const work = mkdtempSync(join(tmpdir(), "pl-service-"));
const stable = tarballVersion(tgz);
const nightly = nightlyAfter(stable);
const release = prepareLauncher({
	tgz,
	work: join(work, "release"),
	releases: [{ version: stable, launcher: true }, { version: nightly }],
});
const prefix = join(work, "prefix");
const workspace = join(work, "workspace");
const launcherDir = join(work, "launcher-cache");
const signals = join(work, "signals.log");
const preload = join(work, "signal-log.mjs");
writeFileSync(
	preload,
	`import { appendFileSync } from "node:fs";
const log = (how) => appendFileSync(${JSON.stringify(signals)}, \`\${process.pid} \${how}\\n\`);
const count = () => log("SIGTERM");
process.on("SIGTERM", count);
// Leaves when the app's own listeners do, so Nest's final re-raise still ends the process by SIGTERM.
process.on("removeListener", (event) => {
	if (event === "SIGTERM" && process.listenerCount("SIGTERM") === 1) process.removeListener("SIGTERM", count);
});
process.on("message", (m) => m === "prismalens:stop" && log("stop request"));
`,
);
const env = {
	...process.env,
	PATH: `${join(prefix, "bin")}:${process.env.PATH}`,
	PRISMALENS_RELEASE_BASE_URL: release.baseUrl,
	PRISMALENS_LAUNCHER_DIR: launcherDir,
	PRISMALENS_TELEMETRY: "off",
	PRISMALENS_UPDATE_CHECK: "off",
};
const run = (file, args, opts = {}) => {
	const r = spawnSync(file, args, { env, encoding: "utf8", ...opts });
	return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const systemctl = (...args) => run("systemctl", ["--user", ...args]);
const show = (prop) =>
	systemctl("show", "-p", prop, "--value", UNIT).out.trim();
const pl = (...args) =>
	run(join(prefix, "bin", "pl"), args, { timeout: 900_000 });

async function health() {
	for (let i = 0; i < 240; i++) {
		const body = await fetch(`http://127.0.0.1:${PORT}/health`, {
			signal: AbortSignal.timeout(2000),
		})
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		if (body?.version) return body.version;
		await sleep(500);
	}
	throw new Error(`no /health on ${PORT}: ${systemctl("status", UNIT).out}`);
}

/** The API process the launcher started: the main pid's child running the archive's app. */
function apiPid() {
	const main = show("MainPID");
	const children = run("pgrep", ["-P", main]).out.split("\n").filter(Boolean);
	const api = children.find((pid) =>
		readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(
			"app/dist/bin/prismalens.js",
		),
	);
	check(api, `no API child under the launcher (main pid ${main})`);
	return api;
}

/** Stops the service by `how`; the API must log one SIGTERM, release the lock and end as success. */
async function stopOnce(how, label) {
	const api = apiPid();
	if (how === "main")
		systemctl("kill", "--kill-whom=main", "--signal=SIGTERM", UNIT);
	else systemctl("stop", UNIT);
	for (let i = 0; i < 120 && show("ActiveState") !== "inactive"; i++)
		await sleep(500);
	check(
		show("ActiveState") === "inactive",
		`${label}: still ${show("ActiveState")}`,
	);
	const lines = readFileSync(signals, "utf8").split("\n");
	const seen = lines.filter((l) => l === `${api} SIGTERM`).length;
	const asked = lines.filter((l) => l === `${api} stop request`).length;
	// The SIGTERM listeners run once whether systemd signalled the whole cgroup or the launcher
	// alone; the launcher's stop request (once, if the API still runs) starts no second shutdown.
	check(
		seen === 1 && asked <= 1 && (how !== "main" || asked === 1),
		`${label}: the API (pid ${api}) ran its SIGTERM listeners ${seen} time(s) and got ${asked} stop request(s)`,
	);
	check(
		show("ExecMainStatus") === "143",
		`${label}: the launcher exited ${show("ExecMainStatus")}, not 143 (SIGTERM through the shutdown hooks)`,
	);
	check(
		!existsSync(join(workspace, "prismalens.lock")),
		`${label}: the workspace lock is still held`,
	);
	check(show("Result") === "success", `${label}: Result=${show("Result")}`);
	ok(
		`${label}: one shutdown in the API, the lock released, the launcher exited 143, Result=success`,
	);
}

async function main() {
	execFileSync(
		"npm",
		[
			"install",
			"-g",
			"--prefix",
			prefix,
			"--no-audit",
			"--no-fund",
			release.launchers[stable],
		],
		{ env, stdio: ["ignore", "ignore", "inherit"] },
	);
	systemctl(
		"set-environment",
		`NODE_OPTIONS=--import=${pathToFileURL(preload).href}`,
	);
	const inst = pl(
		"service",
		"install",
		"--port",
		String(PORT),
		"--workspace",
		workspace,
	);
	check(inst.code === 0, `pl service install: ${inst.out.slice(-800)}`);

	const unitPath = join(homedir(), ".config", "systemd", "user", UNIT);
	const unit = readFileSync(unitPath, "utf8");
	const execStart = /^ExecStart="([^"]+)"/m.exec(unit)?.[1] ?? "";
	const launcher = join(
		prefix,
		"lib",
		"node_modules",
		"prismalens",
		"dist",
		"bin",
		"prismalens.js",
	);
	check(
		existsSync(execStart) && realpathSync(execStart) === realpathSync(launcher),
		`ExecStart runs ${execStart}, not the launcher ${launcher}`,
	);
	check(!execStart.startsWith(launcherDir), "ExecStart runs a cached runtime");
	for (const line of [
		`Environment="PRISMALENS_RELEASE_BASE_URL=${release.baseUrl}"`,
		`Environment="PRISMALENS_LAUNCHER_DIR=${launcherDir}"`,
	])
		check(unit.includes(line), `the unit lacks ${line}:\n${unit}`);
	const verify = run("systemd-analyze", ["--user", "verify", unitPath]);
	check(verify.code === 0, `systemd-analyze --user verify: ${verify.out}`);
	ok(
		`the unit runs the launcher (${execStart}), carries the mirror and cache, and verifies`,
	);

	check(
		(await health()) === stable,
		"the service does not run the stable runtime",
	);
	ok(`the service runs ${stable}`);
	await stopOnce("main", "SIGTERM to the launcher alone");
	systemctl("start", UNIT);
	check((await health()) === stable, "restart after the launcher's SIGTERM");

	const toNightly = pl("upgrade", "--channel", "nightly", "--version", nightly);
	check(
		toNightly.code === 0,
		`pl upgrade --channel nightly: ${toNightly.out.slice(-1200)}`,
	);
	check((await health()) === nightly, "the service did not switch to nightly");
	systemctl("restart", UNIT);
	check((await health()) === nightly, "a restart left the nightly pointer");
	ok(
		`pl upgrade --channel nightly --version ${nightly}: the service runs it, and again after a restart`,
	);

	const toStable = pl("upgrade", "--channel", "stable", "--version", stable);
	check(
		toStable.code === 0,
		`pl upgrade --channel stable: ${toStable.out.slice(-1200)}`,
	);
	check(
		(await health()) === stable,
		"the service did not switch back to stable",
	);
	ok(
		`pl upgrade --channel stable --version ${stable}: the service runs it again`,
	);

	await stopOnce("cgroup", "systemctl stop (SIGTERM to the whole cgroup)");
	const un = pl("service", "uninstall");
	check(
		un.code === 0 && !existsSync(unitPath),
		`pl service uninstall: ${un.out.slice(-400)}`,
	);
	ok("uninstalled");
}

main()
	.catch((e) => {
		failed++;
		console.error(`[service] FAIL ${e?.message ?? e}`);
		console.error(systemctl("status", UNIT).out);
		console.error(
			run("journalctl", ["--user", "-u", UNIT, "-n", "60", "--no-pager"]).out,
		);
	})
	.finally(() => {
		systemctl("unset-environment", "NODE_OPTIONS");
		if (failed) {
			pl("service", "uninstall");
			console.error(`[service] kept ${work}`);
		} else rmSync(work, { recursive: true, force: true });
		process.exit(failed ? 1 : 0);
	});
