// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A run's harness pid on disk, so the next boot can prove the agent from before
 * a stop is gone before it starts another on the same session (#981 OBJ-010).
 */
export interface Receipt {
	pid: number;
	startedAt: number;
}

export interface OsProcess {
	pid: number;
	parent: number;
	/** Creation time, epoch ms. */
	created: number;
}

export interface ProcessHost {
	platform: NodeJS.Platform;
	/** Every process on the machine; Windows only. */
	list(): OsProcess[];
	/** POSIX: is any process in group `pgid` alive. */
	groupAlive(pgid: number): boolean;
	kill(pid: number, group: boolean): void;
	sleep(ms: number): Promise<void>;
}

const FILE = "harness.pid";
/** A pid whose creation time is this far from the receipt's is a reused pid, not ours. */
const SAME_PROCESS_MS = 10_000;

export function writeReceipt(runDir: string, pid: number, now = Date.now()) {
	writeFileSync(join(runDir, FILE), JSON.stringify({ pid, startedAt: now }));
}

export function clearReceipt(runDir: string): void {
	rmSync(join(runDir, FILE), { force: true });
}

export function readReceipt(runDir: string): Receipt | null {
	const path = join(runDir, FILE);
	if (!existsSync(path)) return null;
	try {
		const r = JSON.parse(readFileSync(path, "utf8")) as Partial<Receipt>;
		return typeof r.pid === "number" && typeof r.startedAt === "number"
			? { pid: r.pid, startedAt: r.startedAt }
			: null;
	} catch {
		return null;
	}
}

/**
 * The processes of the tree the receipt started: on Windows a child keeps its
 * parent's pid even after the parent exits, so the tree is walked from the root by
 * parent pid, each step created no earlier than its parent (a reused pid is younger).
 */
export function treeOf(
	receipt: Receipt,
	all: readonly OsProcess[],
): OsProcess[] {
	const out: OsProcess[] = [];
	const root = all.find(
		(p) =>
			p.pid === receipt.pid &&
			Math.abs(p.created - receipt.startedAt) <= SAME_PROCESS_MS,
	);
	if (root) out.push(root);
	const frontier: { pid: number; created: number }[] = [
		{ pid: receipt.pid, created: receipt.startedAt - SAME_PROCESS_MS },
	];
	const seen = new Set<number>();
	while (frontier.length) {
		const parent = frontier.pop() as { pid: number; created: number };
		for (const p of all) {
			if (p.parent !== parent.pid || p.created < parent.created) continue;
			if (seen.has(p.pid) || p.pid === receipt.pid) continue;
			seen.add(p.pid);
			out.push(p);
			frontier.push({ pid: p.pid, created: p.created });
		}
	}
	return out;
}

/** True when nothing of the receipt's tree is left running; kills what is, then checks again. */
export async function containPrevious(
	receipt: Receipt | null,
	host: ProcessHost = osHost(),
): Promise<boolean> {
	if (!receipt) return true;
	const alive = () =>
		host.platform === "win32"
			? treeOf(receipt, host.list())
			: host.groupAlive(receipt.pid)
				? [{ pid: receipt.pid, parent: 0, created: receipt.startedAt }]
				: [];
	for (let attempt = 0; attempt < 3; attempt++) {
		const left = alive();
		if (left.length === 0) return true;
		for (const p of left) host.kill(p.pid, host.platform !== "win32");
		await host.sleep(500);
	}
	return alive().length === 0;
}

export function osHost(): ProcessHost {
	return {
		platform: process.platform,
		list: listWindowsProcesses,
		groupAlive: (pgid) => {
			try {
				process.kill(-pgid, 0);
				return true;
			} catch (e) {
				return (e as NodeJS.ErrnoException).code === "EPERM";
			}
		},
		kill: (pid, group) => {
			try {
				if (group) process.kill(-pid, "SIGKILL");
				else
					spawnSync("taskkill", ["/PID", String(pid), "/F"], {
						windowsHide: true,
					});
			} catch {
				// Already gone.
			}
		},
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	};
}

function listWindowsProcesses(): OsProcess[] {
	const out = spawnSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }",
		],
		{ encoding: "utf8", windowsHide: true, timeout: 20_000 },
	);
	if (out.status !== 0)
		throw new Error(`could not list processes: ${out.stderr}`);
	return out.stdout
		.split(/\r?\n/)
		.map((line) => line.trim().split(/\s+/).map(Number))
		.filter((n) => n.length === 3 && n.every(Number.isFinite))
		.map(([pid, parent, created]) => ({
			pid: pid as number,
			parent: parent as number,
			created: created as number,
		}));
}
