// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's live worktree against the commit recorded at workspace creation (#1020).
 * Git runs on a throwaway GIT_DIR, index and config of ours, so nothing the agent writes in
 * the repo's config or attributes can name a program, and the repo's index is never written.
 * A plain untracked file is opened once for its line count: no-follow and non-blocking where the
 * platform has them, then checked on the open descriptor (a regular file, one link, 4 MB at most),
 * and read no further than 4 MB, so a swap to a link, a FIFO or a device cannot hang it (#1020).
 */
import { constants as fsConstants, mkdirSync } from "node:fs";
import {
	lstat,
	mkdtemp,
	open,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	CommitShaSchema,
	isSafeRepoPath,
	RUN_DIFF_MAX_BYTES,
	type RunWorkspace,
	WORKTREE_MAX_FILES,
	type WorktreeChanges,
	type WorktreeFile,
	type WorktreeRepoChanges,
} from "@prismalens/contracts";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { worktreeRoots } from "../../core/harness/run-worktree.js";

const READ_TIMEOUT_MS = 30_000;
const NULL_FILE = "/dev/null";
/** Config keys copied from the repo so line endings and modes compare as checked out. */
const MIRRORED: Record<string, RegExp> = {
	"core.autocrlf": /^(true|false|input)$/,
	"core.eol": /^(lf|crlf|native)$/,
	"core.filemode": /^(true|false)$/,
	"core.symlinks": /^(true|false)$/,
	"core.ignorecase": /^(true|false)$/,
};

type Repo = RunWorkspace["repos"][number];

/** The process env every call here gets: no inherited config, prompts or locks. */
export function baseEnv(): Record<string, string> {
	return {
		...gitEnv({ source: "none" }),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_ATTR_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: NULL_FILE,
		GIT_LITERAL_PATHSPECS: "1",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_NO_REPLACE_OBJECTS: "1",
	};
}

/** Reads one config value the checkout used; only the whitelisted values survive. */
export async function mirrored(dir: string): Promise<string> {
	// quotePath off: patch headers carry raw paths, as the -z file lists do (#1020).
	const lines = [
		"[core]",
		"\trepositoryformatversion = 0",
		"\tbare = false",
		"\tquotePath = false",
	];
	for (const [key, ok] of Object.entries(MIRRORED)) {
		try {
			const { stdout } = await spawnGit(["config", "--get", key], {
				cwd: dir,
				timeoutMs: GIT_PROBE_TIMEOUT_MS,
				env: baseEnv(),
			});
			const value = stdout.trim().toLowerCase();
			if (ok.test(value)) lines.push(`\t${key.slice(5)} = ${value}`);
		} catch {
			// Unset: git's default.
		}
	}
	return `${lines.join("\n")}\n`;
}

/** The workspace's object store, read from the worktree without running anything in it. */
export async function objectsOf(dir: string): Promise<string | null> {
	try {
		const { stdout } = await spawnGit(
			["rev-parse", "--path-format=absolute", "--git-common-dir"],
			{ cwd: dir, timeoutMs: GIT_PROBE_TIMEOUT_MS, env: baseEnv() },
		);
		const common = stdout.trim();
		return common && isAbsolute(common) ? join(common, "objects") : null;
	} catch {
		return null;
	}
}

/**
 * HEAD against its upstream, as `rev-list --left-right --count @{upstream}...HEAD`
 * reads it; null with no upstream. Resolving refs runs no program the repo config names.
 */
export async function upstreamCounts(
	dir: string,
): Promise<{ ahead: number; behind: number } | null> {
	try {
		const { stdout } = await spawnGit(
			[
				"--no-replace-objects",
				"rev-list",
				"--left-right",
				"--count",
				"@{upstream}...HEAD",
			],
			{ cwd: dir, timeoutMs: GIT_PROBE_TIMEOUT_MS, env: baseEnv() },
		);
		const m = /^(\d+)\s+(\d+)$/.exec(stdout.trim());
		return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null;
	} catch {
		return null;
	}
}

/** A GIT_DIR of our own: alternates to the workspace's objects, our config, an empty index. */
async function scratchRepo(dir: string, objects: string): Promise<string> {
	const gitDir = await mkdtemp(join(tmpdir(), "pl-changes-"));
	mkdirSync(join(gitDir, "objects", "info"), { recursive: true });
	mkdirSync(join(gitDir, "refs", "heads"), { recursive: true });
	await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/scratch\n");
	await writeFile(
		join(gitDir, "objects", "info", "alternates"),
		`${objects}\n`,
	);
	// Unset, git falls back to the host's default attributes and ignore files (#1020).
	const empty = join(gitDir, "empty");
	await writeFile(empty, "");
	const quoted = JSON.stringify(empty.replaceAll("\\", "/"));
	await writeFile(
		join(gitDir, "config"),
		`${await mirrored(dir)}\tattributesFile = ${quoted}\n\texcludesFile = ${quoted}\n`,
	);
	return gitDir;
}

export function numstat(
	out: string,
): Map<string, [number | null, number | null]> {
	const counts = new Map<string, [number | null, number | null]>();
	for (const part of out.split("\0")) {
		const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(part);
		if (!m) continue;
		const [, a, d, path] = m as unknown as [string, string, string, string];
		counts.set(path, [
			a === "-" ? null : Number(a),
			d === "-" ? null : Number(d),
		]);
	}
	return counts;
}

export function nameStatus(out: string): { path: string; code: string }[] {
	const parts = out.split("\0").filter(Boolean);
	const rows: { path: string; code: string }[] = [];
	for (let i = 0; i + 1 < parts.length; i += 2)
		rows.push({ code: parts[i] as string, path: parts[i + 1] as string });
	return rows;
}

export const samePath = (a: string, b: string) =>
	process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * The workspace's real path, only when it is the path the server recorded under one of its
 * locations and neither the location nor any folder below it down to the workspace is a link.
 */
export async function recordedRoot(
	dir: string,
	roots: readonly string[],
): Promise<string | null> {
	const want = resolve(dir);
	for (const r of roots) {
		const base = resolve(r);
		const rel = relative(base, want);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
			continue;
		let at = base;
		for (const part of ["", ...rel.split(sep)]) {
			at = part ? join(at, part) : at;
			const st = await lstat(at).catch(() => null);
			if (!st || st.isSymbolicLink() || !st.isDirectory()) return null;
		}
		const [realBase, real] = await Promise.all([
			realpath(base).catch(() => null),
			realpath(want).catch(() => null),
		]);
		return realBase && real && samePath(real, join(realBase, rel))
			? real
			: null;
	}
	return null;
}

/** More refused paths than this and no content is diffed at all. */
export const MAX_REFUSED = 200;

/**
 * Whether git must not open this changed path: a link on its way, a special file (device,
 * fifo, socket) at the end, or a regular file with another hard link. A path gone from disk is a deletion, diffed from the object store.
 */
export async function linkedPath(root: string, path: string): Promise<boolean> {
	if (!isSafeRepoPath(path)) return true;
	let at = root;
	const parts = path.split("/");
	for (const [i, part] of parts.entries()) {
		at = join(at, part);
		const st = await lstat(at).catch(() => null);
		if (!st) return false;
		if (st.isSymbolicLink()) return true;
		if (i === parts.length - 1 && !st.isFile() && !st.isDirectory())
			return true;
		if (i === parts.length - 1 && st.isFile() && st.nlink > 1) return true;
	}
	return false;
}

/** The work's result, or null once the request's deadline passes first. */
function beforeDeadline<T>(work: Promise<T>, until: number): Promise<T | null> {
	const left = until - Date.now();
	if (left <= 0) return Promise.resolve(null);
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), left);
	});
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A new file past this is listed with no count, as a binary one is. */
export const UNTRACKED_COUNT_MAX_BYTES = 4 * 1024 * 1024;

/** A new file's lines as `git diff --numstat` counts them; null when git would show it as binary. */
export function newFileLines(buf: Buffer): number | null {
	if (buf.subarray(0, 8000).includes(0)) return null;
	if (buf.length === 0) return 0;
	let n = 0;
	for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
	return buf[buf.length - 1] === 10 ? n : n + 1;
}

/**
 * An untracked entry by name; a link on its path is told apart by metadata, never followed.
 * A plain new file counts its lines, so the summary's totals include it (#1101 category 16).
 */
async function untrackedEntry(
	root: string,
	path: string,
): Promise<WorktreeFile> {
	const entry = (
		status: WorktreeFile["status"],
		additions: number | null = null,
	): WorktreeFile => ({
		path,
		status,
		additions,
		deletions: additions === null ? null : 0,
	});
	if (!isSafeRepoPath(path)) return entry("link");
	let at = root;
	let size = Number.POSITIVE_INFINITY;
	for (const part of path.split("/")) {
		at = join(at, part);
		const st = await lstat(at).catch(() => null);
		if (!st || st.isSymbolicLink()) return entry("link");
		if (at === join(root, path) && st.isFile() && st.nlink > 1)
			return entry("link");
		if (at === join(root, path) && st.isFile()) size = st.size;
	}
	if (size > UNTRACKED_COUNT_MAX_BYTES) return entry("added");
	return entry("added", await countOpened(at));
}

/** Not on Windows: there the descriptor checks and the byte cap stand alone. */
const NO_FOLLOW = (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

/** The lines of what `at` opens as, when that is a plain file of one link and 4 MB at most; else null. */
async function countOpened(at: string): Promise<number | null> {
	const fh = await open(at, fsConstants.O_RDONLY | NO_FOLLOW).catch(() => null);
	if (!fh) return null;
	try {
		const st = await fh.stat();
		if (!st.isFile() || st.nlink !== 1 || st.size > UNTRACKED_COUNT_MAX_BYTES)
			return null;
		const buf = Buffer.alloc(Math.min(st.size, UNTRACKED_COUNT_MAX_BYTES));
		let got = 0;
		while (got < buf.length) {
			const { bytesRead } = await fh.read(buf, got, buf.length - got, got);
			if (bytesRead === 0) break;
			got += bytesRead;
		}
		return newFileLines(buf.subarray(0, got));
	} catch {
		return null;
	} finally {
		await fh.close().catch(() => {});
	}
}

/** Gitlinks of the base tree: listed by path, never opened. */
function submodules(out: string): string[] {
	return out
		.split("\0")
		.map((l) => /^160000 [0-9a-f]+ \d\t([\s\S]+)$/.exec(l)?.[1])
		.filter((p): p is string => !!p);
}

async function repoChanges(
	repo: Repo,
	roots: readonly string[],
	deadlineMs: number,
	withPatch = true,
): Promise<WorktreeRepoChanges> {
	const until = Date.now() + deadlineMs;
	const gone = (reason: "removed" | "not-a-workspace" | "commit-gone") =>
		({ state: "unavailable", repo: repo.name, reason }) as const;
	if (!isAbsolute(repo.dir)) return gone("not-a-workspace");
	const stat = await lstat(repo.dir).catch(() => null);
	if (!stat) return gone("removed");
	// A junction or symlink where the workspace was is not the workspace the server made.
	if (stat.isSymbolicLink() || !stat.isDirectory())
		return gone("not-a-workspace");
	if (!CommitShaSchema.safeParse(repo.head).success) return gone("commit-gone");
	const root = await recordedRoot(repo.dir, roots);
	if (!root) return gone("not-a-workspace");
	const objects = await objectsOf(root);
	if (!objects) return gone("not-a-workspace");
	const gitDir = await scratchRepo(root, objects);
	const env: Record<string, string> = {
		...baseEnv(),
		GIT_DIR: gitDir,
		GIT_WORK_TREE: root,
		GIT_INDEX_FILE: join(gitDir, "index"),
	};
	const git = (args: string[], timeoutMs = READ_TIMEOUT_MS, over = env) =>
		spawnGit(["--no-replace-objects", ...args], {
			cwd: root,
			timeoutMs,
			env: over,
		});
	try {
		try {
			await git(["read-tree", repo.head]);
		} catch {
			return gone("commit-gone");
		}
		const diff = [
			"--no-ext-diff",
			"--no-textconv",
			"--ignore-submodules=all",
			"--no-renames",
			"--no-color",
			"--src-prefix=a/",
			"--dst-prefix=b/",
		];
		const [statuses, links] = await Promise.all([
			git(["diff", "--name-status", "-z", ...diff]).then((r) =>
				nameStatus(r.stdout),
			),
			git(["ls-files", "-z", "-s"]).then((r) => submodules(r.stdout)),
		]);
		const refused = new Set<string>();
		for (const { path } of statuses)
			if (await linkedPath(root, path)) refused.add(path);
		// Checked again right before git reads content. A swap in the moment between this
		// check and git's own open cannot be closed with path-based Node APIs (#1020).
		const again = await recordedRoot(repo.dir, roots);
		if (!again || !samePath(again, root)) return gone("not-a-workspace");
		const blocked = refused.size > MAX_REFUSED;
		const content = (args: string[]) =>
			refused.size === 0
				? git(args)
				: git(
						[
							...args,
							"--",
							":(top)",
							...[...refused].map((p) => `:(exclude,top,literal)${p}`),
						],
						READ_TIMEOUT_MS,
						{ ...env, GIT_LITERAL_PATHSPECS: "0" },
					);
		const counts = blocked
			? new Map<string, [number | null, number | null]>()
			: await content(["diff", "--numstat", "-z", ...diff]).then((r) =>
					numstat(r.stdout),
				);
		// Names only, within what is left of the deadline; a late listing says truncated.
		const others = await git(
			["ls-files", "-z", "--others", "--exclude-standard"],
			Math.max(1, until - Date.now()),
		)
			.then((r) => r.stdout.split("\0").filter(Boolean))
			.catch(() => null);
		const files: WorktreeFile[] = statuses.map(({ path, code }) => {
			if (refused.has(path))
				return { path, status: "link", additions: null, deletions: null };
			const [additions, deletions] = counts.get(path) ?? [null, null];
			return {
				path,
				status: code.startsWith("D") ? "deleted" : "modified",
				additions,
				deletions,
			};
		});
		for (const path of links)
			files.push({
				path,
				status: "submodule",
				additions: null,
				deletions: null,
			});
		let tracked = "";
		try {
			tracked = !withPatch
				? ""
				: blocked
					? "\0too-large"
					: (await content(["diff", ...diff])).stdout;
		} catch {
			tracked = "\0too-large";
		}
		let late = others === null;
		for (const path of (others ?? []).slice(0, WORKTREE_MAX_FILES)) {
			// A nested repository shows as its folder with a slash; it is never descended into.
			if (path.endsWith("/")) {
				files.push({
					path: path.slice(0, -1),
					status: "submodule",
					additions: null,
					deletions: null,
				});
				continue;
			}
			const one = await beforeDeadline(untrackedEntry(root, path), until);
			if (!one) {
				late = true;
				break;
			}
			files.push(one);
		}
		const sync = await upstreamCounts(root);
		const tooLarge =
			tracked === "\0too-large" ||
			Buffer.byteLength(tracked) > RUN_DIFF_MAX_BYTES;
		const sum = (k: "additions" | "deletions") =>
			files.reduce((n, f) => n + (f[k] ?? 0), 0);
		return {
			state: "ok",
			repo: repo.name,
			base: repo.head,
			branch: repo.branch,
			files,
			additions: sum("additions"),
			deletions: sum("deletions"),
			patch: tooLarge || !withPatch ? null : tracked,
			omitted: tooLarge ? "too-large" : withPatch ? null : "per-file",
			truncated: late || (others?.length ?? 0) > WORKTREE_MAX_FILES,
			sync,
		};
	} finally {
		await rm(gitDir, { recursive: true, force: true }).catch(() => {});
	}
}

/** Each recorded repo of the run, in the order the workspace lists them. */
export async function readWorktreeChanges(
	workspace: RunWorkspace | null,
	opts: {
		roots?: readonly string[];
		deadlineMs?: number;
		patch?: "none";
	} = {},
): Promise<WorktreeChanges> {
	const repos: WorktreeRepoChanges[] = [];
	// A borrowed checkout (#1024) is read where the user keeps it, against the HEAD it had at start.
	const borrowed =
		workspace?.layout === "in_place" ? workspace.borrowed?.path : undefined;
	const roots = borrowed
		? [dirname(borrowed)]
		: (opts.roots ?? worktreeRoots());
	const deadlineMs = opts.deadlineMs ?? READ_TIMEOUT_MS;
	for (const repo of workspace?.repos ?? [])
		repos.push(
			await repoChanges(repo, roots, deadlineMs, opts.patch !== "none"),
		);
	return { repos };
}
