// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One workspace, one process (#605 edge 5). Two `pl up` on one workspace share
 * a SQLite file, a dispatch loop that fails the other's "running" rows on boot,
 * and a webhook token. The lock is a file holding the owner's pid; a lock whose
 * pid is gone (crash, SIGKILL, reboot) is stale and taken over.
 */

import {
	closeSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";

export const WORKSPACE_LOCK_FILE = "prismalens.lock";

export interface WorkspaceLockOwner {
	pid: number;
	startedAt: string;
}

export class WorkspaceLockedError extends Error {
	constructor(
		readonly lockPath: string,
		readonly owner: WorkspaceLockOwner,
	) {
		super(
			`Another PrismaLens process (pid ${owner.pid}, started ${owner.startedAt}) is using this workspace. Stop it first, or use --workspace for a separate one. Lock: ${lockPath}`,
		);
		this.name = "WorkspaceLockedError";
	}
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

/** The live owner of the workspace lock, or null when unlocked or stale. */
export function readWorkspaceLock(
	workspaceDir: string,
): WorkspaceLockOwner | null {
	try {
		const owner = JSON.parse(
			readFileSync(join(workspaceDir, WORKSPACE_LOCK_FILE), "utf8"),
		) as WorkspaceLockOwner;
		return Number.isInteger(owner.pid) && isAlive(owner.pid) ? owner : null;
	} catch {
		return null;
	}
}

/**
 * Take the lock for this process, or throw {@link WorkspaceLockedError}. Returns
 * the release function; it is also run on process exit.
 */
export function acquireWorkspaceLock(workspaceDir: string): () => void {
	const lockPath = join(workspaceDir, WORKSPACE_LOCK_FILE);
	const owner: WorkspaceLockOwner = {
		pid: process.pid,
		startedAt: new Date().toISOString(),
	};
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(lockPath, "wx", 0o600);
			writeSync(fd, JSON.stringify(owner));
			closeSync(fd);
			const release = () => {
				try {
					const held = JSON.parse(readFileSync(lockPath, "utf8"));
					if (held.pid === process.pid) unlinkSync(lockPath);
				} catch {
					// already gone
				}
			};
			process.once("exit", release);
			return release;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			const live = readWorkspaceLock(workspaceDir);
			if (live && live.pid !== process.pid) {
				throw new WorkspaceLockedError(lockPath, live);
			}
			// Stale, unreadable, or our own leftover: remove and retry once.
			unlinkSync(lockPath);
		}
	}
	throw new Error(`Could not take the workspace lock at ${lockPath}`);
}
