// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
/**
 * A local-folder run works in a `git worktree` of the user's repo under
 * `<app-data>/worktrees/pl-<run>`, so the trust the user gave that repo in their
 * agent covers the run (#918, ADR 0004 §2). Locked while the run is live;
 * unlocked, removed and pruned when it ends and at boot.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";
import { gitEnv } from "./git-env.js";
import { GIT_TIMEOUT_MS, spawnGit } from "./git-spawn.js";

const logger = new Logger("RunWorktree");

export const WORKTREE_PREFIX = "pl-";
const LOCK_REASON = "prismalens run ";

export function worktreeRoot(): string {
	return resolve(getAppDataDir(), "worktrees");
}

/** A run's repos: the worktree itself for one local repo, the parent of each repo's folder for several. */
export function runWorktreeDir(runId: string): string {
	return join(worktreeRoot(), `${WORKTREE_PREFIX}${runId}`);
}

function git(
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<{ stdout: string }> {
	return spawnGit(args, {
		cwd,
		signal,
		env: gitEnv({ source: "machine" }),
		timeoutMs: GIT_TIMEOUT_MS,
	});
}

/**
 * Checks `commit` out at `dest` as a detached, locked worktree of `source`; answers the lock reason,
 * which names this attempt so a late release never removes a later re-add at `dest`.
 * `--no-checkout` then `reset` keeps the user's `post-checkout` hook from firing.
 */
export async function addRunWorktree(
	source: string,
	dest: string,
	commit: string,
	runId: string,
	signal?: AbortSignal,
): Promise<string> {
	const reason = `${LOCK_REASON}${runId} ${randomUUID().slice(0, 8)}`;
	await releaseWorktree(dest);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dirname(dest), { recursive: true });
	try {
		// The path is ours: double force re-adds one a crash left registered, even locked.
		await git(
			[
				"worktree",
				"add",
				"--detach",
				"--no-checkout",
				"-f",
				"-f",
				dest,
				commit,
			],
			source,
			signal,
		);
		// core.longpaths: Git for Windows refuses paths past MAX_PATH without it.
		await git(
			["-c", "core.longpaths=true", "reset", "--hard", "--quiet", commit],
			dest,
			signal,
		);
		await git(["worktree", "lock", "--reason", reason, dest], source, signal);
	} catch (err) {
		await releaseWorktree(dest);
		throw err;
	}
	return reason;
}

/** The admin dir `<repo>/.git/worktrees/<id>` a linked worktree's `.git` file points at, or null. */
function adminDirOf(dir: string): string | null {
	const link = join(dir, ".git");
	try {
		const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(link, "utf8"));
		return m?.[1] ? resolve(dir, m[1].trim()) : null;
	} catch {
		return null;
	}
}

/**
 * Unlocks, removes and prunes the worktree at `dir` when it is unlocked or held
 * by a PrismaLens run; anything else is left alone. True when it is gone.
 */
export async function releaseWorktree(
	dir: string,
	onlyLock?: string,
): Promise<boolean> {
	const admin = adminDirOf(dir);
	if (!admin) return !existsSync(dir);
	const lockFile = join(admin, "locked");
	const lock = existsSync(lockFile)
		? readFileSync(lockFile, "utf8").trim()
		: null;
	if (lock !== null && !lock.startsWith(LOCK_REASON)) return false;
	if (onlyLock !== undefined && lock !== onlyLock) return false;
	let common: string;
	try {
		common = resolve(
			admin,
			readFileSync(join(admin, "commondir"), "utf8").trim(),
		);
	} catch {
		// The source repo is gone or moved: nothing of the user's to clean.
		rmSync(dir, { recursive: true, force: true });
		return true;
	}
	// Run from the common dir: Windows refuses to delete a directory that is git's cwd.
	try {
		if (lock !== null) await git(["worktree", "unlock", dir], common);
		await git(["worktree", "remove", "--force", dir], common);
	} catch (e) {
		logger.warn(
			`Could not remove the run worktree ${dir}: ${(e as Error).message}`,
		);
		rmSync(dir, { recursive: true, force: true });
	}
	try {
		await git(["worktree", "prune"], common);
	} catch (e) {
		logger.warn(
			`Could not prune worktrees of ${common}: ${(e as Error).message}`,
		);
	}
	return !existsSync(dir);
}

/**
 * Releases `dir` if it is a worktree, else every worktree directly inside it,
 * then deletes what is left. A worktree locked by someone else keeps `dir`.
 */
export async function releaseWorktreesIn(
	dir: string,
	onlyLock?: string,
): Promise<void> {
	if (!existsSync(dir)) return;
	let kept = false;
	if (adminDirOf(dir)) kept = !(await releaseWorktree(dir, onlyLock));
	else
		for (const entry of readdirSync(dir, { withFileTypes: true }))
			if (entry.isDirectory() && adminDirOf(join(dir, entry.name)))
				kept =
					!(await releaseWorktree(join(dir, entry.name), onlyLock)) || kept;
	if (!kept) rmSync(dir, { recursive: true, force: true });
}

/**
 * At boot nothing is running, so a `pl-*` entry under our root is a dead run's,
 * even when its lock outlived the process. Answers the run ids it swept.
 */
export async function sweepRunWorktrees(): Promise<string[]> {
	const root = worktreeRoot();
	if (!existsSync(root)) return [];
	const swept: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(WORKTREE_PREFIX))
			continue;
		await releaseWorktreesIn(join(root, entry.name));
		swept.push(entry.name.slice(WORKTREE_PREFIX.length));
	}
	return swept;
}
