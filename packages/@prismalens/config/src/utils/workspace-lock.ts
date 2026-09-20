// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One workspace, one process (#605 edge 5). Two `pl up` on one workspace share
 * a SQLite file, a dispatch loop that fails the other's "running" rows on boot,
 * and a webhook token. The lock is a file holding the owner's pid; a lock whose
 * pid is gone (crash, SIGKILL, reboot) is stale and taken over.
 *
 * Two races decide the shape of this (review on #662):
 *
 *  - The file must never be observable empty. `open("wx")` then `write` leaves a
 *    window where a second process reads nothing and would call the live lock
 *    stale. So the owner is written to a temp file first and `link`ed into
 *    place, which is atomic and fails when the lock already exists.
 *  - Reclaiming a stale lock is check-then-act. Two processes can both read
 *    "stale" and both unlink and create. Reclamation therefore happens while
 *    holding a second, exclusive `.steal` file, and re-checks inside it.
 *
 * The owner record is `{pid, port, startedAt}`. `port` is here for a launcher
 * rather than for this process: an Electron shell that finds the workspace
 * already held is meant to connect to that backend instead of refusing, and the
 * port is the only thing it would otherwise have to guess. Nothing in this
 * repository attaches yet — that behaviour is Electron work (#83) and is
 * deliberately not built here; this only makes sure the information exists when
 * it is.
 *
 * ## Two known gaps, neither closed here
 *
 * 1. **Pid reuse after a crash.** Liveness is `kill(pid, 0)`, which answers
 *    "some process has this pid", not "*our* process has this pid". After a
 *    reboot or a deep crash the operating system can hand the recorded pid to
 *    something unrelated, and this reads the lock as held by a live owner
 *    forever. `startedAt` is not a fix: a pid reused within the same boot would
 *    still pass any age test worth writing. The escape is in the refusal
 *    message, which names the lock path so `rm <workspace>/prismalens.lock`
 *    clears it. Closing it properly needs a boot id (`/proc/sys/kernel/random/boot_id`,
 *    `kern.boottime`) recorded beside the pid, which is per-platform work.
 * 2. **`link()` is not atomic everywhere.** Creation relies on `link(2)`
 *    failing with `EEXIST` when the target exists, which holds on every local
 *    POSIX filesystem and on NFS, and is why it is used instead of `open("wx")`.
 *    It does not hold on exFAT (no hard links at all: creation throws `EPERM`
 *    rather than `EEXIST`, so `pl up` fails outright rather than sharing a
 *    workspace), and it is not trustworthy inside a cloud-synced folder
 *    (Dropbox, OneDrive, iCloud Drive), where a second machine's lock arrives
 *    by replication with no ordering guarantee at all. A workspace on
 *    synchronised storage is outside what this protects — **UNVERIFIED** for
 *    the specific behaviour of each sync client.
 */

import {
	closeSync,
	linkSync,
	openSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";

export const WORKSPACE_LOCK_FILE = "prismalens.lock";
const STEAL_SUFFIX = ".steal";
/**
 * How long an unreadable lock is left alone. With the link protocol above a
 * lock is written before it exists, so unreadable means corruption or a lock
 * from an older build — neither is urgent, and waiting costs one boot.
 */
export const MALFORMED_GRACE_MS = 30_000;

export interface WorkspaceLockOwner {
	pid: number;
	/** The port the owner intends to serve on, so a launcher can reach it. */
	port: number;
	startedAt: string;
}

/** What the lock file says right now. */
export type WorkspaceLockState =
	| { kind: "free" }
	| { kind: "held"; owner: WorkspaceLockOwner }
	| { kind: "stale"; owner: WorkspaceLockOwner }
	/** Present but not parseable as an owner: corrupt, or written by another build. */
	| { kind: "unreadable"; ageMs: number }
	/** Present and readable, but we could not tell — never reclaimed. */
	| { kind: "undecidable"; reason: string };

export class WorkspaceLockedError extends Error {
	constructor(
		readonly lockPath: string,
		readonly detail: string,
	) {
		super(detail);
		this.name = "WorkspaceLockedError";
	}
}

function ownerBusy(lockPath: string, owner: WorkspaceLockOwner): Error {
	return new WorkspaceLockedError(
		lockPath,
		`Another PrismaLens process (pid ${owner.pid}, port ${owner.port}, started ${owner.startedAt}) is using this workspace. Stop it first, or use --workspace for a separate one. Lock: ${lockPath}`,
	);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM: the pid exists but belongs to another user, so it is alive.
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Classify the lock file without touching it. */
export function readWorkspaceLockState(
	workspaceDir: string,
): WorkspaceLockState {
	const lockPath = join(workspaceDir, WORKSPACE_LOCK_FILE);
	let raw: string;
	let ageMs: number;
	try {
		raw = readFileSync(lockPath, "utf8");
		ageMs = Date.now() - statSync(lockPath).mtimeMs;
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { kind: "free" };
		// EACCES, EIO and friends say nothing about the holder, so nothing is reclaimed.
		return { kind: "undecidable", reason: code ?? "unreadable" };
	}
	try {
		const owner = JSON.parse(raw) as WorkspaceLockOwner;
		if (
			!Number.isInteger(owner.pid) ||
			!Number.isInteger(owner.port) ||
			typeof owner.startedAt !== "string"
		) {
			return { kind: "unreadable", ageMs };
		}
		return isAlive(owner.pid)
			? { kind: "held", owner }
			: { kind: "stale", owner };
	} catch {
		return { kind: "unreadable", ageMs };
	}
}

/** The live owner of the workspace lock, or null when unlocked, stale or unreadable. */
export function readWorkspaceLock(
	workspaceDir: string,
): WorkspaceLockOwner | null {
	const state = readWorkspaceLockState(workspaceDir);
	return state.kind === "held" ? state.owner : null;
}

/** A lock file appears with its content already in it: create elsewhere, then link. */
function createLock(lockPath: string, owner: WorkspaceLockOwner): void {
	const tmpPath = `${lockPath}.${process.pid}.tmp`;
	const fd = openSync(tmpPath, "wx", 0o600);
	try {
		writeSync(fd, JSON.stringify(owner));
	} finally {
		closeSync(fd);
	}
	try {
		linkSync(tmpPath, lockPath);
	} finally {
		try {
			unlinkSync(tmpPath);
		} catch {
			// best effort
		}
	}
}

/** Reclaim a stale or long-unreadable lock, serialized by an exclusive `.steal` file. */
function reclaim(
	workspaceDir: string,
	lockPath: string,
	owner: WorkspaceLockOwner,
): boolean {
	const stealPath = `${lockPath}${STEAL_SUFFIX}`;
	let stealFd: number;
	try {
		stealFd = openSync(stealPath, "wx", 0o600);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw e;
	}
	try {
		// Re-check inside the steal lock: the holder may have been replaced
		// between the first read and here.
		const state = readWorkspaceLockState(workspaceDir);
		const reclaimable =
			state.kind === "stale" ||
			(state.kind === "unreadable" && state.ageMs > MALFORMED_GRACE_MS);
		if (!reclaimable) return false;
		unlinkSync(lockPath);
		createLock(lockPath, owner);
		return true;
	} finally {
		closeSync(stealFd);
		try {
			unlinkSync(stealPath);
		} catch {
			// best effort
		}
	}
}

/**
 * Take the lock for this process, or throw {@link WorkspaceLockedError}. Returns
 * the release function; it is also run on process exit.
 */
export function acquireWorkspaceLock(
	workspaceDir: string,
	options: { port: number },
): () => void {
	const lockPath = join(workspaceDir, WORKSPACE_LOCK_FILE);
	const owner: WorkspaceLockOwner = {
		pid: process.pid,
		// The port this process is about to listen on. The lock is taken before
		// `listen`, so this is an intent: if the bind then fails the process
		// exits and the lock goes with it.
		port: options.port,
		startedAt: new Date().toISOString(),
	};
	const release = () => {
		try {
			const held = JSON.parse(
				readFileSync(lockPath, "utf8"),
			) as WorkspaceLockOwner;
			if (held.pid === process.pid) unlinkSync(lockPath);
		} catch {
			// already gone, or not ours
		}
	};

	try {
		createLock(lockPath, owner);
		process.once("exit", release);
		return release;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
	}

	const state = readWorkspaceLockState(workspaceDir);
	if (state.kind === "held") {
		if (state.owner.pid === process.pid) {
			process.once("exit", release);
			return release;
		}
		throw ownerBusy(lockPath, state.owner);
	}
	if (state.kind === "undecidable") {
		throw new WorkspaceLockedError(
			lockPath,
			`Cannot read the workspace lock (${state.reason}), so it is not taken over. Fix its permissions, or remove ${lockPath} if no PrismaLens process is running.`,
		);
	}
	if (state.kind === "unreadable" && state.ageMs <= MALFORMED_GRACE_MS) {
		throw new WorkspaceLockedError(
			lockPath,
			`A workspace lock was just created and cannot be read yet. Retry in a few seconds, or remove ${lockPath} if no PrismaLens process is running.`,
		);
	}
	if (state.kind === "free") {
		// It went away between the create and the read; one more try, no reclaim.
		createLock(lockPath, owner);
		process.once("exit", release);
		return release;
	}
	if (!reclaim(workspaceDir, lockPath, owner)) {
		const now = readWorkspaceLockState(workspaceDir);
		throw new WorkspaceLockedError(
			lockPath,
			now.kind === "held"
				? ownerBusy(lockPath, now.owner).message
				: `Another process is reclaiming the workspace lock at ${lockPath}. Retry in a few seconds.`,
		);
	}
	process.once("exit", release);
	return release;
}
