// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFile } from "node:fs/promises";
/**
 * What the remote holds for a thread's branch, without a fetch (#1101 bar 15.1): the PR
 * poll's head read, or `git ls-remote` for a pushed branch with no watch. Kept per worktree.
 */
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { PR_WATCH_EVERY_MS } from "@prismalens/contracts";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_LS_REMOTE_TIMEOUT_MS,
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { baseEnv } from "./worktree-changes.js";

export interface RemoteHead {
	/** The branch name on the remote, and the remote's short name for the hint. */
	branch: string;
	remote: string;
	exists: boolean;
	sha: string | null;
	forcePushed: boolean;
	/** The PR poll's host read, or `ls-remote`. */
	source: "host" | "ls-remote";
	at: number;
}

/** A reading older than three polls no longer speaks for the remote. */
const FRESH_MS = 3 * PR_WATCH_EVERY_MS;
const heads = new Map<string, RemoteHead>();
const listeners = new Set<() => void>();

export function setRemoteHead(dir: string, head: RemoteHead): void {
	heads.set(dir, head);
	if (heads.size > 2000) heads.delete(heads.keys().next().value as string);
	for (const l of listeners) l();
}

/** The worktree's last remote reading, while fresh. */
export function remoteHeadOf(dir: string, now = Date.now()): RemoteHead | null {
	const h = heads.get(dir);
	return h && now - h.at < FRESH_MS ? h : null;
}

/** Called when a reading lands, so a cached state is read again. */
export function onRemoteHead(listener: () => void): void {
	listeners.add(listener);
}

export const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The worktree's own git dir: `.git` itself, or the folder its `.git` file points to. */
export async function gitDirOf(dir: string): Promise<string | null> {
	const dot = join(dir, ".git");
	try {
		const text = await readFile(dot, "utf8");
		const m = /^gitdir:\s*(.+)\s*$/m.exec(text);
		if (!m?.[1]) return null;
		return isAbsolute(m[1]) ? m[1] : join(dir, m[1]);
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EISDIR" ? dot : null;
	}
}

export async function branchOfDir(gitDir: string): Promise<string | null> {
	const head = await readFile(join(gitDir, "HEAD"), "utf8").catch(() => "");
	return /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(head)?.[1] ?? null;
}

const probe = async (cwd: string, args: string[]) =>
	(
		await spawnGit(["-c", "core.fsmonitor=false", ...args], {
			cwd,
			timeoutMs: GIT_PROBE_TIMEOUT_MS,
			env: baseEnv(),
		})
	).stdout.trim();

/** Only URLs git reaches without running a program the repo config could name. */
const REACHABLE = /^(?:https:\/\/|ssh:\/\/|[\w.-]+@[\w.-]+:|file:\/\/)/i;

/**
 * One `ls-remote` for a branch that was pushed (it has an upstream or a remote-tracking
 * ref). It runs outside the repo, so the agent-writable repo config is only read, never obeyed.
 */
export async function lsRemoteHead(dir: string): Promise<RemoteHead | null> {
	const gitDir = await gitDirOf(dir);
	const branch = gitDir ? await branchOfDir(gitDir) : null;
	if (!branch) return null;
	const rows = (
		await probe(dir, [
			"for-each-ref",
			"--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)",
			`refs/heads/${branch}`,
			`refs/remotes/*/${branch}`,
		])
	)
		.split("\n")
		.filter(Boolean)
		.map((l) => l.split("\0"));
	const local = rows.find((r) => r[0] === `refs/heads/${branch}`);
	const tracking = rows.find((r) => r[0]?.startsWith("refs/remotes/"))?.[0];
	const remote =
		local?.[1] || (tracking ? tracking.split("/")[2] : undefined) || null;
	const ref = local?.[2] || `refs/heads/${branch}`;
	if (!remote || !/^[\w.-]+$/.test(remote)) return null;
	const url = await probe(dir, [
		"config",
		"--get",
		`remote.${remote}.url`,
	]).catch(() => "");
	if (!url || !(REACHABLE.test(url) || isAbsolute(url))) return null;
	const out = await spawnGit(
		["-c", "protocol.ext.allow=never", "ls-remote", "--heads", "--", url, ref],
		{
			cwd: tmpdir(),
			timeoutMs: GIT_LS_REMOTE_TIMEOUT_MS,
			env: gitEnv({ source: "machine" }),
		},
	);
	const line = out.stdout
		.split("\n")
		.find((l) => l.split("\t")[1]?.trim() === ref);
	const sha = line?.split("\t")[0]?.trim() ?? null;
	return {
		branch: ref.replace(/^refs\/heads\//, ""),
		remote,
		exists: !!line,
		sha: sha && SHA.test(sha) ? sha : null,
		forcePushed: false,
		source: "ls-remote",
		at: Date.now(),
	};
}
