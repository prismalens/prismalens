// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The git state a thread's worktree is stuck in (#1101 bar 15.1): an unfinished merge or
 * rebase, or a branch rewritten, moved or deleted on its remote. The remote's own reading
 * (`remote-heads.ts`) outranks the local tracking refs, which go stale without a fetch.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	GIT_CONFLICT_FILES_MAX,
	type GitState,
	type RunWorkspace,
} from "@prismalens/contracts";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import {
	branchOfDir,
	gitDirOf,
	onRemoteHead,
	type RemoteHead,
	remoteHeadOf,
	SHA,
} from "./remote-heads.js";
import { baseEnv } from "./worktree-changes.js";

const git = async (cwd: string, args: string[]): Promise<string> =>
	(
		await spawnGit(
			["-c", "core.fsmonitor=false", "--no-replace-objects", ...args],
			{ cwd, timeoutMs: GIT_PROBE_TIMEOUT_MS, env: baseEnv() },
		)
	).stdout;

const OPS: [string, Extract<GitState, { state: "conflict" }>["op"]][] = [
	["rebase-merge", "rebase"],
	["rebase-apply", "rebase"],
	["MERGE_HEAD", "merge"],
	["CHERRY_PICK_HEAD", "cherry-pick"],
	["REVERT_HEAD", "revert"],
];

async function conflictOf(
	dir: string,
	gitDir: string,
): Promise<GitState | null> {
	const op = OPS.find(([f]) => existsSync(join(gitDir, f)))?.[1] ?? null;
	if (!op) return null;
	const out = await git(dir, ["ls-files", "-u", "-z"]);
	const files = [
		...new Set(
			out
				.split("\0")
				.filter(Boolean)
				.map((l) => l.slice(l.indexOf("\t") + 1)),
		),
	];
	if (!files.length) return null;
	return {
		state: "conflict",
		op,
		files: files.slice(0, GIT_CONFLICT_FILES_MAX),
		count: files.length,
	};
}

const short = (ref: string) => ref.replace(/^refs\/remotes\//, "");

const counted = async (dir: string, range: string) => {
	const m = /^(\d+)\s+(\d+)$/.exec(
		(await git(dir, ["rev-list", "--left-right", "--count", range])).trim(),
	);
	return { behind: Number(m?.[1] ?? 0), ahead: Number(m?.[2] ?? 0) };
};

/**
 * The remote's reading against the branch: gone; diverged when its tip is here; rewritten
 * when the host says force-pushed; else moved to a tip this worktree has not seen.
 */
async function fromRemote(
	dir: string,
	branch: string,
	seen: RemoteHead,
): Promise<GitState | null> {
	const name = `${seen.remote}/${seen.branch}`;
	if (!seen.exists) return { state: "gone", branch, upstream: name };
	if (!seen.sha || !SHA.test(seen.sha)) return null;
	const head = (
		await git(dir, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])
	).trim();
	if (seen.sha === head) return null;
	const known = await git(dir, ["cat-file", "-e", `${seen.sha}^{commit}`]).then(
		() => true,
		() => false,
	);
	if (known) {
		const { ahead, behind } = await counted(
			dir,
			`${seen.sha}...refs/heads/${branch}`,
		);
		return ahead > 0 && behind > 0
			? { state: "rewritten", branch, remote: name, ahead, behind }
			: null;
	}
	return seen.forcePushed
		? { state: "rewritten", branch, remote: name, ahead: null, behind: null }
		: { state: "moved", branch, remote: name, sha: seen.sha.slice(0, 12) };
}

/** A branch's upstream gone, or its remote copy diverged from it: rewritten under it. */
async function remoteOf(dir: string, gitDir: string): Promise<GitState | null> {
	const branch = await branchOfDir(gitDir);
	if (!branch) return null;
	const seen = remoteHeadOf(dir);
	if (seen) return fromRemote(dir, branch, seen);
	const out = await git(dir, [
		"for-each-ref",
		"--format=%(refname)%00%(upstream)%00%(upstream:track)",
		`refs/heads/${branch}`,
		`refs/remotes/*/${branch}`,
	]);
	const rows = out
		.split("\n")
		.filter(Boolean)
		.map((l) => l.split("\0"));
	const local = rows.find((r) => r[0] === `refs/heads/${branch}`);
	const upstream = local?.[1] ?? "";
	if (upstream && local?.[2] === "[gone]")
		return { state: "gone", branch, upstream: short(upstream) };
	const remote =
		upstream || rows.find((r) => r[0]?.startsWith("refs/remotes/"))?.[0] || "";
	if (!remote) return null;
	const { ahead, behind } = await counted(
		dir,
		`${remote}...refs/heads/${branch}`,
	);
	return ahead > 0 && behind > 0
		? { state: "rewritten", branch, remote: short(remote), ahead, behind }
		: null;
}

/** One repo's state; a conflict outranks the remote's. Null when clean or unreadable. */
export async function readGitState(dir: string): Promise<GitState | null> {
	try {
		const gitDir = await gitDirOf(dir);
		if (!gitDir) return null;
		return (await conflictOf(dir, gitDir)) ?? (await remoteOf(dir, gitDir));
	} catch {
		return null;
	}
}

const RANK: Record<GitState["state"], number> = {
	conflict: 0,
	gone: 1,
	rewritten: 2,
	moved: 3,
};
const TTL_MS = 15_000;
const GIT_LAYOUTS = new Set<RunWorkspace["layout"]>([
	"single",
	"multi",
	"in_place",
]);
const cache = new Map<
	string,
	{ at: number; state: Promise<GitState | null> }
>();
onRemoteHead(() => cache.clear());

/** The workspace's worst state across its own repos, kept a few seconds per workspace. */
export function workspaceGitState(
	ws: RunWorkspace | null,
	now = Date.now(),
): Promise<GitState | null> {
	if (!ws || !GIT_LAYOUTS.has(ws.layout)) return Promise.resolve(null);
	const key = ws.repos.map((r) => r.dir).join("\0");
	const kept = cache.get(key);
	if (kept && now - kept.at < TTL_MS) return kept.state;
	const state = Promise.all(ws.repos.map((r) => readGitState(r.dir))).then(
		(all) =>
			all
				.filter((s): s is GitState => !!s)
				.sort((a, b) => RANK[a.state] - RANK[b.state])[0] ?? null,
	);
	cache.set(key, { at: now, state });
	if (cache.size > 500) cache.delete(cache.keys().next().value as string);
	return state;
}
