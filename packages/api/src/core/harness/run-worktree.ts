// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A local-folder run works in a `git worktree` of the user's repo under
 * `<app-data>/worktrees/pl-<run>`, so the trust the user gave that repo in their
 * agent covers the run (#918, ADR 0004 §2). The worktree is agent-host's workspace
 * (#916): locked while the run is live, released when it ends, and swept at boot.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import {
	createWorkspace,
	type RemovalRecord,
	releaseWorkspace,
	resolveWorkspacePolicy,
	sweepWorkspaces,
	type WorkspaceOwner,
} from "@prismalens/agent-host";
import { getAppDataDir } from "@prismalens/config";

const logger = new Logger("RunWorktree");

export const WORKTREE_PREFIX = "pl-";
const LOCK_PREFIX = "prismalens run ";
/** No workspace settings yet (#925): a run's worktree goes when the run ends. */
const RUN_POLICY = resolveWorkspacePolicy({
	method: "worktree",
	retention: { kind: "always-remove" },
}).policy;

export function worktreeRoot(): string {
	return resolve(getAppDataDir(), "worktrees");
}

/** A run's repos: the worktree itself for one local repo, the parent of each repo's folder for several. */
export function runWorktreeDir(runId: string): string {
	return join(worktreeRoot(), `${WORKTREE_PREFIX}${runId}`);
}

/** A path as a workspace: owned by its parent folder with no prefix, so a multi-repo run's folders fit too. */
function asWorkspace(dir: string): WorkspaceOwner & { id: string } {
	return {
		parentDir: dirname(dir),
		prefix: "",
		lockPrefix: LOCK_PREFIX,
		id: basename(dir),
	};
}

function isLinkedWorktree(dir: string): boolean {
	try {
		return /^gitdir:/m.test(readFileSync(join(dir, ".git"), "utf8"));
	} catch {
		return false;
	}
}

function warnKept(records: RemovalRecord[]): void {
	for (const r of records)
		if (!r.removed && r.reason !== "superseded")
			logger.warn(`Kept the run worktree ${r.dir}: ${r.reason}`);
}

/**
 * Checks `commit` out at `dest` as a detached, locked worktree of `source`, after releasing
 * whatever an earlier attempt left there; answers the lock reason, which names this attempt.
 */
export async function addRunWorktree(
	source: string,
	dest: string,
	commit: string,
	runId: string,
	signal?: AbortSignal,
): Promise<string> {
	await releaseWorktree(dest);
	const workspace = await createWorkspace({
		...asWorkspace(dest),
		lockLabel: runId,
		source: { kind: "local", repo: source, commit },
		policy: RUN_POLICY,
		...(signal ? { signal } : {}),
	});
	return workspace.lock;
}

/**
 * Unlocks, removes and prunes the worktree at `dir` unless someone else's lock holds it,
 * or, with `onlyLock`, a later attempt re-added it. True when it is gone.
 */
export async function releaseWorktree(
	dir: string,
	onlyLock?: string,
): Promise<boolean> {
	const records = await releaseWorkspace({
		...asWorkspace(dir),
		policy: RUN_POLICY,
		...(onlyLock !== undefined ? { onlyLock } : {}),
	});
	warnKept(records);
	return records[0]?.removed === true;
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
	if (isLinkedWorktree(dir)) kept = !(await releaseWorktree(dir, onlyLock));
	else
		for (const entry of readdirSync(dir, { withFileTypes: true }))
			if (entry.isDirectory() && isLinkedWorktree(join(dir, entry.name)))
				kept =
					!(await releaseWorktree(join(dir, entry.name), onlyLock)) || kept;
	if (!kept) rmSync(dir, { recursive: true, force: true });
}

async function sweepIn(
	parentDir: string,
	prefix: string,
): Promise<RemovalRecord[]> {
	const records = await sweepWorkspaces({
		parentDir,
		prefix,
		lockPrefix: LOCK_PREFIX,
		policy: RUN_POLICY,
		isLive: () => false,
	});
	warnKept(records);
	return records;
}

/**
 * At boot nothing is running, so a `pl-*` entry under our root is a dead run's,
 * even when its lock outlived the process. Answers the run ids it swept.
 */
export async function sweepRunWorktrees(): Promise<string[]> {
	const root = worktreeRoot();
	if (!existsSync(root)) return [];
	// A multi-repo run's entry holds a worktree per repo; those go first.
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const dir = join(root, entry.name);
		if (
			entry.isDirectory() &&
			entry.name.startsWith(WORKTREE_PREFIX) &&
			!isLinkedWorktree(dir)
		)
			await sweepIn(dir, "");
	}
	return (await sweepIn(root, WORKTREE_PREFIX))
		.filter((r) => r.removed)
		.map((r) => r.id);
}
