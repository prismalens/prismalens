// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The detached half of Install and restart (#724). The old server starts this
 * with its own Node and exits; this waits for it, brings the new version up
 * (a terminal copy) or lets the service manager do it, and watches `/health`.
 * If the new version never reports itself, it puts the previous runtime, and
 * the database backup the new version's migration took, back, and starts the
 * previous version again. Node built-ins only: it runs after the API is gone.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const RESULT_FILE = "update-result.json";

export interface HandoffConfig {
	/** The old server's pid; nothing starts until it has exited. */
	pid: number;
	mode: "terminal" | "systemd" | "launchd";
	from: string;
	to: string;
	healthUrl: string;
	workspaceDir: string;
	/** Epoch millis the install began; only backups newer than this are restored. */
	startedAt: number;
	deadlineMs: number;
	logPath: string;
	/** The installer's wrappers and runtimes, for switching back. */
	binDir: string;
	runtimeRoot: string;
	/** `pl up`'s own argv after `pl`, for a terminal copy. */
	upArgs: string[];
	platform: NodeJS.Platform;
	uid: number;
}

export interface HandoffResult {
	from: string;
	to: string;
	result: "done" | "failed";
	reason?: string;
	at: string;
}

export interface HandoffDeps {
	alive(pid: number): boolean;
	health(url: string): Promise<string | null>;
	sleep(ms: number): Promise<void>;
	now(): number;
	/** Starts a detached `pl up`; returns a probe that is true once it has exited. */
	launch(
		runtimeDir: string,
		cfg: HandoffConfig,
	): { exited(): boolean; kill(): void };
	run(argv: string[]): boolean;
}

function launcher(runtimeDir: string, platform: NodeJS.Platform): string {
	return join(runtimeDir, "bin", platform === "win32" ? "pl.cmd" : "pl");
}

/** Point the `pl` wrappers and the receipt back at `version`'s runtime. */
export function switchWrappers(
	binDir: string,
	runtimeRoot: string,
	from: string,
	to: string,
	dataDir: string,
): string | null {
	if (!existsSync(join(runtimeRoot, to))) return `runtime ${to} is gone`;
	for (const name of ["pl", "prismalens", "pl.cmd", "prismalens.cmd"]) {
		const path = join(binDir, name);
		if (!existsSync(path)) continue;
		const body = readFileSync(path, "utf8");
		// With the separator, so 0.6.1 never matches inside 0.6.10.
		const next = body
			.split(`${join(runtimeRoot, from)}${sep}`)
			.join(`${join(runtimeRoot, to)}${sep}`);
		if (next !== body) writeFileSync(path, next, { mode: 0o755 });
	}
	const receipt = join(dataDir, "receipt");
	if (existsSync(receipt)) {
		writeFileSync(
			receipt,
			readFileSync(receipt, "utf8").replace(/^version=.*$/m, `version=${to}`),
		);
	}
	return null;
}

/** The migration runner's newest backup taken after `since`, put back over the database. */
export function restoreBackup(
	workspaceDir: string,
	since: number,
): string | null {
	const newest = readdirSync(workspaceDir)
		.map((name) => ({
			name,
			at: Number(/^prismalens\.db\.bak-(\d+)$/.exec(name)?.[1]),
		}))
		.filter((b) => Number.isFinite(b.at) && b.at >= since)
		.sort((a, b) => b.at - a.at)[0];
	if (!newest) return null;
	const db = join(workspaceDir, "prismalens.db");
	for (const side of ["-wal", "-shm"]) rmSync(`${db}${side}`, { force: true });
	copyFileSync(join(workspaceDir, newest.name), db);
	return newest.name;
}

function writeResult(workspaceDir: string, result: HandoffResult): void {
	try {
		writeFileSync(
			join(workspaceDir, RESULT_FILE),
			`${JSON.stringify(result)}\n`,
		);
	} catch {
		// The next About read simply shows no outcome.
	}
}

export function readHandoffResult(workspaceDir: string): HandoffResult | null {
	try {
		const raw = JSON.parse(
			readFileSync(join(workspaceDir, RESULT_FILE), "utf8"),
		) as HandoffResult;
		return typeof raw.to === "string" && typeof raw.result === "string"
			? raw
			: null;
	} catch {
		return null;
	}
}

function serviceArgv(cfg: HandoffConfig, action: "stop" | "start"): string[][] {
	if (cfg.mode === "systemd")
		return action === "stop"
			? [["systemctl", "--user", "stop", "prismalens.service"]]
			: [
					["systemctl", "--user", "reset-failed", "prismalens.service"],
					["systemctl", "--user", "start", "prismalens.service"],
				];
	if (cfg.mode === "launchd")
		return action === "stop"
			? []
			: [
					[
						"launchctl",
						"kickstart",
						"-k",
						`gui/${cfg.uid}/io.prismalens.server`,
					],
				];
	return [];
}

export async function runHandoff(
	cfg: HandoffConfig,
	deps: HandoffDeps,
): Promise<HandoffResult> {
	const waitUntil = deps.now() + 60_000;
	while (deps.alive(cfg.pid) && deps.now() < waitUntil) await deps.sleep(250);

	const child =
		cfg.mode === "terminal"
			? deps.launch(join(cfg.runtimeRoot, cfg.to), cfg)
			: null;
	const deadline = deps.now() + cfg.deadlineMs;
	let reason = `${cfg.to} didn't answer on ${cfg.healthUrl} within ${Math.round(cfg.deadlineMs / 1000)}s`;
	while (deps.now() < deadline) {
		const version = await deps.health(cfg.healthUrl);
		if (version === cfg.to) {
			const done: HandoffResult = {
				from: cfg.from,
				to: cfg.to,
				result: "done",
				at: new Date(deps.now()).toISOString(),
			};
			writeResult(cfg.workspaceDir, done);
			return done;
		}
		if (child?.exited()) {
			reason = `${cfg.to} exited before it was ready; see ${cfg.logPath}`;
			break;
		}
		await deps.sleep(1_000);
	}

	child?.kill();
	for (const argv of serviceArgv(cfg, "stop")) deps.run(argv);
	const restored = restoreBackup(cfg.workspaceDir, cfg.startedAt);
	const switched = switchWrappers(
		cfg.binDir,
		cfg.runtimeRoot,
		cfg.to,
		cfg.from,
		join(cfg.runtimeRoot, ".."),
	);
	const failed: HandoffResult = {
		from: cfg.from,
		to: cfg.to,
		result: "failed",
		reason: [
			reason,
			restored ? `database restored from ${restored}` : null,
			switched,
		]
			.filter(Boolean)
			.join("; "),
		at: new Date(deps.now()).toISOString(),
	};
	writeResult(cfg.workspaceDir, failed);
	if (cfg.mode === "terminal")
		deps.launch(join(cfg.runtimeRoot, cfg.from), cfg);
	else for (const argv of serviceArgv(cfg, "start")) deps.run(argv);
	return failed;
}

/* v8 ignore start -- the real process glue; runHandoff is tested through HandoffDeps */
const realDeps: HandoffDeps = {
	alive(pid) {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "EPERM";
		}
	},
	async health(url) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
			if (!res.ok) return null;
			const body = (await res.json()) as { version?: unknown };
			return typeof body.version === "string" ? body.version : null;
		} catch {
			return null;
		}
	},
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	now: Date.now,
	launch(runtimeDir, cfg) {
		const out = openSync(cfg.logPath, "a");
		const file = launcher(runtimeDir, cfg.platform);
		const child =
			cfg.platform === "win32"
				? spawn("cmd.exe", ["/d", "/s", "/c", `"${file}"`, ...cfg.upArgs], {
						detached: true,
						stdio: ["ignore", out, out],
						windowsHide: true,
						windowsVerbatimArguments: true,
					})
				: spawn(file, cfg.upArgs, {
						detached: true,
						stdio: ["ignore", out, out],
					});
		let exited = false;
		child.on("exit", () => {
			exited = true;
		});
		child.on("error", () => {
			exited = true;
		});
		child.unref();
		return {
			exited: () => exited,
			kill: () => {
				try {
					child.kill();
				} catch {
					// Already gone.
				}
			},
		};
	},
	run(argv) {
		return spawnSync(argv[0], argv.slice(1), { stdio: "ignore" }).status === 0;
	},
};

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const cfg = JSON.parse(
		readFileSync(process.argv[2], "utf8"),
	) as HandoffConfig;
	void runHandoff(cfg, realDeps).then(() => process.exit(0));
}
/* v8 ignore stop */
