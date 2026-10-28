// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * A run's harness pid on disk, so the next boot can prove the agent from before
 * a stop is gone before it starts another on the same session (#981 OBJ-010).
 */
export interface Receipt {
	pid: number;
	startedAt: number;
	/** The root's own creation time as the OS reported it, once a snapshot saw it. */
	rootCreated?: number;
	/** The tree as last seen while the run worked (Windows), so an orphaned grandchild is still known. */
	tree?: { pid: number; created: number }[];
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
/** How far before the receipt a dead root's children may have been born. */
const SAME_PROCESS_MS = 10_000;
/** CIM creation times and Date.now() disagree by clock rounding only. */
const ROUNDING_MS = 1_000;
/** A recorded member's creation time read twice through CIM differs by rounding only. */
const SAME_MEMBER_MS = 2_000;
export const SNAPSHOT_MS = 30_000;

export function writeReceipt(
	runDir: string,
	pid: number,
	now = Date.now(),
	seen?: Pick<Receipt, "rootCreated" | "tree">,
) {
	writeFileSync(
		join(runDir, FILE),
		JSON.stringify({ pid, startedAt: now, ...(seen ?? {}) }),
	);
}

export function clearReceipt(runDir: string): void {
	rmSync(join(runDir, FILE), { force: true });
}

export function readReceipt(runDir: string): Receipt | null {
	const path = join(runDir, FILE);
	if (!existsSync(path)) return null;
	try {
		const r = JSON.parse(readFileSync(path, "utf8")) as Partial<Receipt>;
		if (typeof r.pid !== "number" || typeof r.startedAt !== "number")
			return null;
		const tree = Array.isArray(r.tree)
			? r.tree.filter(
					(m) => typeof m?.pid === "number" && typeof m?.created === "number",
				)
			: undefined;
		return {
			pid: r.pid,
			startedAt: r.startedAt,
			...(typeof r.rootCreated === "number"
				? { rootCreated: r.rootCreated }
				: {}),
			...(tree ? { tree } : {}),
		};
	} catch {
		return null;
	}
}

/**
 * The processes of the tree the receipt started. A child keeps its parent's pid after
 * the parent exits, so the walk starts from the root and from every member the last
 * snapshot saw. A pid now held by a younger process only claims children born before it.
 */
export function treeOf(
	receipt: Receipt,
	all: readonly OsProcess[],
): OsProcess[] {
	const out = new Map<number, OsProcess>();
	const frontier: { pid: number; from: number; until: number }[] = [];
	const seed = (pid: number, created: number, slack: number) => {
		const holder = all.find((p) => p.pid === pid);
		const ours = !!holder && Math.abs(holder.created - created) <= slack;
		if (ours && holder) out.set(pid, holder);
		frontier.push({
			pid,
			from: created - slack,
			until: holder && !ours ? holder.created : Number.POSITIVE_INFINITY,
		});
	};
	// No two live processes share a pid: one holding the root's pid that was born before
	// the receipt was written is the root, however late the receipt (#981 OBJ-010).
	const holder = all.find((p) => p.pid === receipt.pid);
	const rootOurs =
		!!holder &&
		(receipt.rootCreated !== undefined
			? Math.abs(holder.created - receipt.rootCreated) <= SAME_MEMBER_MS
			: holder.created <= receipt.startedAt + ROUNDING_MS);
	if (rootOurs && holder) out.set(receipt.pid, holder);
	frontier.push({
		pid: receipt.pid,
		from:
			receipt.rootCreated ??
			(rootOurs && holder
				? holder.created
				: receipt.startedAt - SAME_PROCESS_MS),
		until: holder && !rootOurs ? holder.created : Number.POSITIVE_INFINITY,
	});
	for (const m of receipt.tree ?? []) seed(m.pid, m.created, SAME_MEMBER_MS);
	const walked = new Set<number>();
	while (frontier.length) {
		const parent = frontier.pop() as (typeof frontier)[number];
		if (walked.has(parent.pid)) continue;
		walked.add(parent.pid);
		for (const p of all) {
			if (p.parent !== parent.pid) continue;
			if (p.created < parent.from || p.created >= parent.until) continue;
			if (out.has(p.pid)) continue;
			out.set(p.pid, p);
			frontier.push({
				pid: p.pid,
				from: p.created,
				until: Number.POSITIVE_INFINITY,
			});
		}
	}
	return [...out.values()];
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

/**
 * Re-records the run's tree into its receipt while the run works, so a boot after a
 * crash still knows a tool whose parent had already exited. Windows only: POSIX
 * reaps by process group. Returns the stop function.
 */
export function watchReceipt(
	runDir: string,
	list: () => Promise<OsProcess[]> = listWindowsProcessesAsync,
	everyMs = SNAPSHOT_MS,
): () => void {
	if (process.platform !== "win32" && list === listWindowsProcessesAsync)
		return () => {};
	let busy = false;
	let stopped = false;
	const timer = setInterval(() => {
		if (busy) return;
		busy = true;
		void snapshotReceipt(runDir, list, () => !stopped).finally(() => {
			busy = false;
		});
	}, everyMs);
	timer.unref();
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}

export async function snapshotReceipt(
	runDir: string,
	list: () => Promise<OsProcess[]>,
	live: () => boolean = () => true,
): Promise<void> {
	try {
		const receipt = readReceipt(runDir);
		if (!receipt) return;
		const found = treeOf(receipt, await list());
		const root = found.find((p) => p.pid === receipt.pid);
		const tree = found
			.filter((p) => p.pid !== receipt.pid)
			.map(({ pid, created }) => ({ pid, created }));
		// Only the receipt it read, still watched: a later turn's receipt is never overwritten (#981 OBJ-021).
		const now = readReceipt(runDir);
		if (
			!live() ||
			now?.pid !== receipt.pid ||
			now.startedAt !== receipt.startedAt
		)
			return;
		writeReceipt(runDir, receipt.pid, receipt.startedAt, {
			...(root
				? { rootCreated: root.created }
				: receipt.rootCreated !== undefined
					? { rootCreated: receipt.rootCreated }
					: {}),
			tree,
		});
	} catch {
		// A missed snapshot leaves the last one; the next tick tries again.
	}
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

const LIST_ARGS = [
	"-NoProfile",
	"-NonInteractive",
	"-Command",
	"Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }",
];

function parseList(stdout: string): OsProcess[] {
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim().split(/\s+/).map(Number))
		.filter((n) => n.length === 3 && n.every(Number.isFinite))
		.map(([pid, parent, created]) => ({
			pid: pid as number,
			parent: parent as number,
			created: created as number,
		}));
}

function listWindowsProcesses(): OsProcess[] {
	const out = spawnSync("powershell.exe", LIST_ARGS, {
		encoding: "utf8",
		windowsHide: true,
		timeout: 20_000,
	});
	if (out.status !== 0)
		throw new Error(`could not list processes: ${out.stderr}`);
	return parseList(out.stdout);
}

async function listWindowsProcessesAsync(): Promise<OsProcess[]> {
	const { stdout } = await promisify(execFile)("powershell.exe", LIST_ARGS, {
		encoding: "utf8",
		windowsHide: true,
		timeout: 20_000,
		maxBuffer: 8 * 1024 * 1024,
	});
	return parseList(stdout);
}
