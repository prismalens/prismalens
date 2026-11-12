// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Snapshots of a thread's worktree as commits in a store of PrismaLens's own (#1101 category 16).
 * The store reads the workspace's objects through alternates and writes only to itself: the
 * user's repository, refs and index are never written. Only paths `linkedPath` passes are added.
 */
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getAppDataDir } from "@prismalens/config";
import {
	CommitShaSchema,
	isSafeRepoPath,
	type RunWorkspace,
	WORKTREE_FILE_MAX_BYTES,
	WORKTREE_MAX_FILES,
} from "@prismalens/contracts";
import { spawnGit } from "../../core/harness/git-spawn.js";
import {
	baseEnv,
	linkedPath,
	MAX_REFUSED,
	mirrored,
	objectsOf,
	recordedRoot,
	samePath,
} from "./worktree-changes.js";

const GIT_TIMEOUT_MS = 60_000;
/** All untracked files a snapshot takes, together. */
export const SNAPSHOT_UNTRACKED_MAX_BYTES = 50 * 1024 * 1024;
/** "Now" snapshots closer together than this are one. */
const COALESCE_MS = 2_000;
export const TURN_REF = "refs/pl/turn";
export const REVERT_REF = "refs/pl/revert";
const NOTE = "PrismaLens snapshot";

type Repo = RunWorkspace["repos"][number];

export type StoreRefusal =
	| "removed"
	| "not-a-workspace"
	| "commit-gone"
	| "too-many-links"
	| "unsupported";

export class SnapshotUnavailable extends Error {
	constructor(readonly reason: StoreRefusal) {
		super(`Snapshot unavailable: ${reason}`);
	}
}

/** `<appData>/snapshots/<runId>`, refusing an id that would resolve anywhere else. */
export function snapshotsDirFor(runId: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(runId))
		throw new Error(`Invalid run id for snapshots: ${runId}`);
	return join(resolve(getAppDataDir(), "snapshots"), runId);
}

interface GitOpts {
	/** Run against the worktree and an index: ours unless `index` names another. */
	work?: boolean;
	index?: string;
	input?: string;
	/** Pathspecs with magic (`:(exclude)`) need literal pathspecs off. */
	magic?: boolean;
	signal?: AbortSignal;
}

export interface SnapshotStore {
	gitDir: string;
	root: string;
	repo: Repo;
	/** The locations the workspace was recorded under, re-checked before each write. */
	roots: readonly string[];
	git: (args: string[], o?: GitOpts) => Promise<string>;
}

const locks = new Map<string, Promise<unknown>>();

/** One snapshot or mutation at a time per store: they share its index and its refs. */
export function withStoreLock<T>(gitDir: string, work: () => Promise<T>) {
	const next = (locks.get(gitDir) ?? Promise.resolve())
		.catch(() => {})
		.then(work);
	locks.set(
		gitDir,
		next.catch(() => {}),
	);
	return next;
}

const exists = async (p: string) => !!(await lstat(p).catch(() => null));

async function inWorktree(root: string, args: string[]): Promise<string> {
	return (
		await spawnGit(args, {
			cwd: root,
			timeoutMs: GIT_TIMEOUT_MS,
			env: baseEnv(),
		})
	).stdout.trim();
}

/** Opens (and on first use makes) the store for one repo of the run. */
export async function openStore(
	runId: string,
	repoIndex: number,
	repo: Repo,
	roots: readonly string[],
): Promise<SnapshotStore> {
	if (!isAbsolute(repo.dir)) throw new SnapshotUnavailable("not-a-workspace");
	const st = await lstat(repo.dir).catch(() => null);
	if (!st) throw new SnapshotUnavailable("removed");
	if (st.isSymbolicLink() || !st.isDirectory())
		throw new SnapshotUnavailable("not-a-workspace");
	if (!CommitShaSchema.safeParse(repo.head).success)
		throw new SnapshotUnavailable("commit-gone");
	const root = await recordedRoot(repo.dir, roots);
	if (!root) throw new SnapshotUnavailable("not-a-workspace");
	const objects = await objectsOf(root);
	if (!objects) throw new SnapshotUnavailable("not-a-workspace");
	// A sparse checkout's absent files would read as deletions.
	const sparse = await inWorktree(root, [
		"config",
		"--get",
		"core.sparseCheckout",
	]).catch(() => "");
	if (sparse.toLowerCase() === "true")
		throw new SnapshotUnavailable("unsupported");
	const gitDir = join(snapshotsDirFor(runId), `${repoIndex}.git`);
	if (!(await exists(join(gitDir, "HEAD")))) {
		await mkdir(join(gitDir, "objects", "info"), { recursive: true });
		await mkdir(join(gitDir, "refs", "heads"), { recursive: true });
		await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/snapshots\n");
		await writeFile(join(gitDir, "empty"), "");
	}
	const q = (p: string) => JSON.stringify(p.replaceAll("\\", "/"));
	const empty = join(gitDir, "empty");
	const exclude = await inWorktree(root, [
		"rev-parse",
		"--path-format=absolute",
		"--git-path",
		"info/exclude",
	]).catch(() => "");
	// The workspace's own excludes become ours; the host's global ignore file is the user's.
	await mkdir(join(gitDir, "info"), { recursive: true });
	await writeFile(
		join(gitDir, "info", "exclude"),
		exclude && isAbsolute(exclude)
			? await readFile(exclude).catch(() => "")
			: "",
	);
	const globalIgnore = await hostIgnoreFile();
	// Rewritten on each open: a workspace recreated at the same path brings its own objects.
	await writeFile(
		join(gitDir, "config"),
		`${await mirrored(root)}\tattributesFile = ${q(empty)}\n\texcludesFile = ${q(
			globalIgnore ?? empty,
		)}\n\thooksPath = ${q(empty)}\n[gc]\n\tauto = 0\n`,
	);
	await writeFile(
		join(gitDir, "objects", "info", "alternates"),
		`${objects}\n`,
	);
	const env = {
		...baseEnv(),
		GIT_DIR: gitDir,
		GIT_AUTHOR_NAME: "PrismaLens",
		GIT_AUTHOR_EMAIL: "snapshots@prismalens.invalid",
		GIT_COMMITTER_NAME: "PrismaLens",
		GIT_COMMITTER_EMAIL: "snapshots@prismalens.invalid",
	};
	const store: SnapshotStore = {
		gitDir,
		root,
		repo,
		roots,
		git: async (args, o = {}) => {
			const over: Record<string, string> = o.work
				? {
						...env,
						GIT_WORK_TREE: root,
						GIT_INDEX_FILE: o.index ?? join(gitDir, "index"),
					}
				: o.index
					? { ...env, GIT_INDEX_FILE: o.index }
					: env;
			const r = await spawnGit(["--no-replace-objects", ...args], {
				cwd: o.work ? root : gitDir,
				timeoutMs: GIT_TIMEOUT_MS,
				env: o.magic ? { ...over, GIT_LITERAL_PATHSPECS: "0" } : over,
				...(o.input !== undefined ? { input: o.input } : {}),
				...(o.signal ? { signal: o.signal } : {}),
			});
			return r.stdout;
		},
	};
	// Ours from HEAD's tree, never a copy of the worktree's index or its flags.
	if (!(await exists(join(gitDir, "index"))))
		await store.git(["read-tree", await worktreeHead(store)], { work: true });
	return store;
}

/** The host user's global ignore file: `core.excludesFile`, else git's default path. */
async function hostIgnoreFile(): Promise<string | null> {
	const set = await spawnGit(
		["config", "--global", "--path", "--get", "core.excludesFile"],
		{ timeoutMs: GIT_TIMEOUT_MS, env: { ...baseEnv(), GIT_CONFIG_GLOBAL: "" } },
	)
		.then((r) => r.stdout.trim())
		.catch(() => "");
	const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	const path = set && isAbsolute(set) ? set : join(xdg, "git", "ignore");
	return (await exists(path)) ? path : null;
}

/** The worktree's HEAD commit. */
export async function worktreeHead(store: SnapshotStore): Promise<string> {
	const sha = await inWorktree(store.root, [
		"rev-parse",
		"--verify",
		"HEAD^{commit}",
	]).catch(() => "");
	if (!CommitShaSchema.safeParse(sha).success)
		throw new SnapshotUnavailable("commit-gone");
	return sha;
}

/** The workspace still resolves to the folder the store opened; a swapped link fails. */
export async function sameRoot(store: SnapshotStore): Promise<void> {
	const again = await recordedRoot(store.repo.dir, store.roots);
	if (!again || !samePath(again, store.root))
		throw new SnapshotUnavailable("not-a-workspace");
}

export interface Snapshot {
	commit: string;
	/** Paths left out: a link on the way, a special or hard-linked file, a nested repository, or too large. */
	skipped: string[];
}

export function skippedOf(message: string): string[] {
	const m = /\n\n(\{[\s\S]*\})\s*$/.exec(message);
	try {
		const v = m ? (JSON.parse(m[1] as string) as { skipped?: unknown }) : null;
		return Array.isArray(v?.skipped)
			? v.skipped.filter((p): p is string => typeof p === "string")
			: [];
	} catch {
		return [];
	}
}

const zsplit = (s: string) => s.split("\0").filter(Boolean);

/**
 * The worktree as it is now: tracked changes and untracked files that pass the checks,
 * ignored ones left out, as a commit whose parent is HEAD. Callers hold the store's lock.
 */
export async function takeSnapshot(
	store: SnapshotStore,
	o: { ref?: string; signal?: AbortSignal } = {},
): Promise<Snapshot> {
	const signal = o.signal;
	const head = await worktreeHead(store);
	const [changed, others, extras] = await Promise.all([
		store
			.git(["diff-files", "--name-only", "-z", "--ignore-submodules=all"], {
				work: true,
				signal,
			})
			.then(zsplit),
		store
			.git(["ls-files", "-z", "--others", "--exclude-standard"], {
				work: true,
				signal,
			})
			.then(zsplit),
		// Entries a past snapshot added that HEAD does not track.
		store
			.git(
				[
					"diff-index",
					"--cached",
					"--name-only",
					"--diff-filter=A",
					"-z",
					head,
				],
				{
					work: true,
					signal,
				},
			)
			.then(zsplit),
	]);
	const skipped: string[] = [];
	const drop = new Set<string>();
	const extraSet = new Set(extras);
	const ignored = extras.length
		? zsplit(
				await store
					.git(["check-ignore", "-z", "--stdin", "--no-index"], {
						work: true,
						input: `${extras.join("\0")}\0`,
						signal,
					})
					.catch(() => ""),
			)
		: [];
	for (const p of ignored) drop.add(p);
	const take: string[] = [];
	for (const path of changed) {
		if (!isSafeRepoPath(path) || (await linkedPath(store.root, path))) {
			skipped.push(path);
			if (extraSet.has(path)) drop.add(path);
			continue;
		}
		if (extraSet.has(path) && !drop.has(path)) {
			const st = await lstat(join(store.root, path)).catch(() => null);
			if (st && st.size > WORKTREE_FILE_MAX_BYTES) {
				skipped.push(path);
				drop.add(path);
				continue;
			}
		}
		if (!drop.has(path)) take.push(path);
	}
	let bytes = 0;
	let count = 0;
	for (const path of others) {
		if (path.endsWith("/") || !isSafeRepoPath(path)) {
			skipped.push(path.replace(/\/$/, ""));
			continue;
		}
		if (await linkedPath(store.root, path)) {
			skipped.push(path);
			continue;
		}
		const st = await lstat(join(store.root, path)).catch(() => null);
		if (!st) continue;
		if (
			st.size > WORKTREE_FILE_MAX_BYTES ||
			bytes + st.size > SNAPSHOT_UNTRACKED_MAX_BYTES ||
			count >= WORKTREE_MAX_FILES
		) {
			skipped.push(path);
			continue;
		}
		bytes += st.size;
		count++;
		take.push(path);
	}
	if (skipped.length > MAX_REFUSED)
		throw new SnapshotUnavailable("too-many-links");
	if (drop.size)
		await store.git(
			[
				"rm",
				"--cached",
				"-q",
				"--ignore-unmatch",
				"--pathspec-from-file=-",
				"--pathspec-file-nul",
			],
			{ work: true, input: `${[...drop].join("\0")}\0`, signal },
		);
	// Checked again right before git reads content, as worktree-changes.ts does (#1020).
	await sameRoot(store);
	if (take.length)
		await store.git(
			["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
			{ work: true, input: `${take.join("\0")}\0`, signal },
		);
	const tree = (await store.git(["write-tree"], { work: true, signal })).trim();
	const commit = (
		await store.git(["commit-tree", tree, "-p", head, "-F", "-"], {
			input: `${NOTE}\n\n${JSON.stringify({ skipped })}\n`,
			signal,
		})
	).trim();
	// A snapshot that came too late is never published.
	if (o.ref && !signal?.aborted) await store.git(["update-ref", o.ref, commit]);
	return { commit, skipped };
}

const recent = new Map<string, { at: number; snap: Snapshot }>();

/** The files as they are now, reusing a snapshot under two seconds old. Holds the lock. */
export function nowSnapshot(store: SnapshotStore): Promise<Snapshot> {
	return withStoreLock(store.gitDir, async () => {
		const hit = recent.get(store.gitDir);
		if (hit && Date.now() - hit.at < COALESCE_MS) return hit.snap;
		const snap = await takeSnapshot(store);
		recent.set(store.gitDir, { at: Date.now(), snap });
		return snap;
	});
}

/** A snapshot just taken under the lock replaces the cached one. */
export function forgetNow(store: SnapshotStore) {
	recent.delete(store.gitDir);
}

export interface TurnSnapshot {
	seq: number;
	start: string | null;
	end: string | null;
}

/** The run's turns that have a snapshot, oldest first. */
export async function turnSnapshots(
	store: SnapshotStore,
): Promise<TurnSnapshot[]> {
	const out = await store.git([
		"for-each-ref",
		"--format=%(refname) %(objectname)",
		TURN_REF,
	]);
	const turns = new Map<number, TurnSnapshot>();
	for (const line of out.split("\n")) {
		const m = /^refs\/pl\/turn\/(\d+)\/(start|end) ([0-9a-f]{40,64})$/.exec(
			line.trim(),
		);
		if (!m) continue;
		const seq = Number(m[1]);
		const t = turns.get(seq) ?? { seq, start: null, end: null };
		t[m[2] as "start" | "end"] = m[3] as string;
		turns.set(seq, t);
	}
	return [...turns.values()].sort((a, b) => a.seq - b.seq);
}

/** Reverts with a before and a target but no after: cut off mid-write. */
export async function interruptedReverts(
	store: SnapshotStore,
): Promise<string[]> {
	const out = await store.git([
		"for-each-ref",
		"--format=%(refname)",
		REVERT_REF,
	]);
	const seen = new Map<string, Set<string>>();
	for (const line of out.split("\n")) {
		const m = /^refs\/pl\/revert\/(\d+)\/(before|target|after)$/.exec(
			line.trim(),
		);
		if (!m) continue;
		const set = seen.get(m[1] as string) ?? new Set();
		set.add(m[2] as string);
		seen.set(m[1] as string, set);
	}
	return [...seen]
		.filter(([, s]) => s.has("before") && s.has("target") && !s.has("after"))
		.map(([id]) => id);
}

/** Paths that differ between two commits, gitlinks left out. */
export async function changedPaths(
	store: SnapshotStore,
	from: string,
	to: string,
): Promise<string[]> {
	const out = await store.git([
		"diff-tree",
		"-r",
		"--no-renames",
		"--name-only",
		"-z",
		"--ignore-submodules=all",
		from,
		to,
	]);
	return zsplit(out).filter(isSafeRepoPath);
}

/** `mode blob` per path at a commit; a path the commit lacks maps to "absent". */
export async function statesAt(
	store: SnapshotStore,
	commit: string,
	paths: readonly string[],
): Promise<Map<string, string>> {
	const out = new Map<string, string>(paths.map((p) => [p, "absent"]));
	if (!paths.length) return out;
	const listed = await store.git([
		"ls-tree",
		"-r",
		"-z",
		"--full-tree",
		commit,
		"--",
		...paths,
	]);
	for (const row of zsplit(listed)) {
		const m = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(row);
		if (m && out.has(m[4] as string))
			out.set(m[4] as string, `${m[1]} ${m[3]}`);
	}
	return out;
}

/** A throwaway index file, removed by `done`. */
export async function scratchIndex(): Promise<{
	path: string;
	done: () => Promise<void>;
}> {
	const dir = await mkdtemp(join(tmpdir(), "pl-revert-"));
	return {
		path: join(dir, "index"),
		done: () => rm(dir, { recursive: true, force: true }),
	};
}
