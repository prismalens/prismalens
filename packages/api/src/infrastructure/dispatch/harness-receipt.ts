// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
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
	/** POSIX: where the group was started, so a later boot or another machine never kills by a reused pid. */
	host?: string;
	boot?: string;
	/** POSIX: the group leader's start stamp, from the same reader that checks it. */
	leaderStart?: number;
}

type Stamp = Pick<Receipt, "host" | "boot" | "leaderStart">;

export interface OsProcess {
	pid: number;
	parent: number;
	/** Creation time, epoch ms. */
	created: number;
}

export interface ProcessHost {
	platform: NodeJS.Platform;
	/** Every process on the machine; Windows only. */
	list(): OsProcess[] | Promise<OsProcess[]>;
	/** POSIX: is any process in group `pgid` alive. */
	groupAlive(pgid: number): boolean;
	kill(pid: number, group: boolean): void | Promise<void>;
	sleep(ms: number): Promise<void>;
	/** POSIX: this machine and its current boot; `boot` is null when unreadable. */
	identity(): { host: string; boot: string | null };
	/** POSIX: the start stamp of the process holding `pid`, or null when none does. */
	startOf(pid: number): number | null;
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
	seen?: Pick<Receipt, "rootCreated" | "tree"> & Stamp,
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
			...(typeof r.host === "string" ? { host: r.host } : {}),
			...(typeof r.boot === "string" ? { boot: r.boot } : {}),
			...(typeof r.leaderStart === "number"
				? { leaderStart: r.leaderStart }
				: {}),
		};
	} catch {
		return null;
	}
}

/** What a POSIX receipt records so a later check can tell the harness's group from a stranger's. */
export function stampOf(pid: number, host: ProcessHost = osHost()): Stamp {
	if (host.platform === "win32") return {};
	try {
		const { host: name, boot } = host.identity();
		const leaderStart = host.startOf(pid);
		return {
			host: name,
			...(boot !== null ? { boot } : {}),
			...(leaderStart !== null ? { leaderStart } : {}),
		};
	} catch {
		return {};
	}
}

/**
 * Whether a live POSIX group `receipt.pid` is the harness's: "gone" when this host has
 * rebooted since, "unproven" when nothing ties it to the receipt. A leaderless group is
 * unproven: its id may have been reused by a stranger's group whose leader then exited.
 */
function posixOwner(
	receipt: Receipt,
	host: ProcessHost,
): "ours" | "gone" | "unproven" {
	const now = host.identity();
	if (receipt.host === undefined || receipt.host !== now.host)
		return "unproven";
	if (receipt.boot === undefined || now.boot === null) return "unproven";
	if (receipt.boot !== now.boot) return "gone";
	const leader = host.startOf(receipt.pid);
	return leader !== null && leader === receipt.leaderStart
		? "ours"
		: "unproven";
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

/**
 * True when nothing of the receipt's tree is left running; kills what is, then checks
 * again. Once `signal` aborts it kills nothing more and answers false.
 */
export async function containPrevious(
	receipt: Receipt | null,
	host: ProcessHost = osHost(),
	signal?: AbortSignal,
): Promise<boolean> {
	if (!receipt) return true;
	if (host.platform !== "win32" && host.groupAlive(receipt.pid)) {
		const owner = posixOwner(receipt, host);
		if (owner !== "ours") return owner === "gone";
	}
	const alive = async () =>
		host.platform === "win32"
			? treeOf(receipt, await host.list())
			: host.groupAlive(receipt.pid)
				? [{ pid: receipt.pid, parent: 0, created: receipt.startedAt }]
				: [];
	for (let attempt = 0; attempt < 3; attempt++) {
		const left = await alive();
		if (left.length === 0) return true;
		for (const p of left) {
			if (signal?.aborted) return false;
			await host.kill(p.pid, host.platform !== "win32");
		}
		await host.sleep(500);
	}
	return (await alive()).length === 0;
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
		const { host, boot, leaderStart } = receipt;
		writeReceipt(runDir, receipt.pid, receipt.startedAt, {
			...(host !== undefined ? { host } : {}),
			...(boot !== undefined ? { boot } : {}),
			...(leaderStart !== undefined ? { leaderStart } : {}),
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

const SYNC_PROBE_TIMEOUT_MS = 3_000;

export function osHost(): ProcessHost {
	return {
		platform: process.platform,
		list: listWindowsProcessesAsync,
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
					return promisify(execFile)("taskkill", ["/PID", String(pid), "/F"], {
						windowsHide: true,
						timeout: 10_000,
					}).then(
						() => {},
						() => {},
					);
			} catch {
				// Already gone.
			}
		},
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		identity: () => ({ host: hostname(), boot: bootId() }),
		startOf: process.platform === "linux" ? linuxStartOf : psStartOf,
	};
}

/** Field 22 of /proc/<pid>/stat, clock ticks since boot; the command (field 2) may hold spaces and parens. */
export function procStartTime(stat: string): number | null {
	const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	const ticks = Number(rest[19]);
	return stat.includes(")") && Number.isFinite(ticks) ? ticks : null;
}

function linuxStartOf(pid: number): number | null {
	let stat: string;
	try {
		stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	}
	const ticks = procStartTime(stat);
	if (ticks === null) throw new Error(`unreadable /proc/${pid}/stat`);
	return ticks;
}

function psStartOf(pid: number): number | null {
	// Bounded well under the lease transaction's limit: containment runs inside it.
	const out = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
		encoding: "utf8",
		timeout: SYNC_PROBE_TIMEOUT_MS,
	});
	if (out.error) throw out.error;
	const text = out.stdout.trim();
	if (!text && out.status === 1) return null;
	const at = Date.parse(text);
	if (!Number.isFinite(at)) throw new Error(`ps gave no start for ${pid}`);
	return at;
}

function bootId(): string | null {
	try {
		if (process.platform === "linux")
			return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
		const out = spawnSync("sysctl", ["-n", "kern.boottime"], {
			encoding: "utf8",
			timeout: SYNC_PROBE_TIMEOUT_MS,
		});
		return out.status === 0 && out.stdout.trim() ? out.stdout.trim() : null;
	} catch {
		return null;
	}
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

async function listWindowsProcessesAsync(): Promise<OsProcess[]> {
	const { stdout } = await promisify(execFile)("powershell.exe", LIST_ARGS, {
		encoding: "utf8",
		windowsHide: true,
		timeout: 20_000,
		maxBuffer: 8 * 1024 * 1024,
	});
	return parseList(stdout);
}
