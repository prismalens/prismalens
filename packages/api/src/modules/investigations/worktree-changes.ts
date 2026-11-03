// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's live worktree against the commit recorded at workspace creation (#1020).
 * Git runs on a throwaway GIT_DIR, index and config of ours, so nothing the agent writes in
 * the repo's config or attributes can name a program, and the repo's index is never written.
 */
import { type BigIntStats, constants, mkdirSync } from "node:fs";
import {
	type FileHandle,
	lstat,
	mkdtemp,
	open,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	CommitShaSchema,
	isSafeRepoPath,
	RUN_DIFF_MAX_BYTES,
	type RunWorkspace,
	WORKTREE_FILE_MAX_BYTES,
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
/** Where the platform lacks O_NOFOLLOW, the identity check after open stands alone. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
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
function baseEnv(): Record<string, string> {
	return {
		...gitEnv({ source: "none" }),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: NULL_FILE,
		GIT_LITERAL_PATHSPECS: "1",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_NO_REPLACE_OBJECTS: "1",
	};
}

/** Reads one config value the checkout used; only the whitelisted values survive. */
async function mirrored(dir: string): Promise<string> {
	const lines = ["[core]", "\trepositoryformatversion = 0", "\tbare = false"];
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
async function objectsOf(dir: string): Promise<string | null> {
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

function numstat(out: string): Map<string, [number | null, number | null]> {
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

function nameStatus(out: string): { path: string; code: string }[] {
	const parts = out.split("\0").filter(Boolean);
	const rows: { path: string; code: string }[] = [];
	for (let i = 0; i + 1 < parts.length; i += 2)
		rows.push({ code: parts[i] as string, path: parts[i + 1] as string });
	return rows;
}

const samePath = (a: string, b: string) =>
	process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const within = (root: string, path: string) =>
	path.length > root.length + 1 &&
	samePath(path.slice(0, root.length + 1), root + sep);
const sameFile = (a: BigIntStats, b: BigIntStats) =>
	a.dev === b.dev && a.ino === b.ino;

/**
 * The workspace's real path, only when it is the path the server recorded under one of its
 * locations: a link in place of the workspace or of any folder below the location refuses it.
 */
async function recordedRoot(
	dir: string,
	roots: readonly string[],
): Promise<string | null> {
	const want = resolve(dir);
	for (const r of roots) {
		const base = resolve(r);
		const rel = relative(base, want);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
			continue;
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

/** What the untracked reads of one request may still spend. */
interface Budget {
	bytes: number;
	until: number;
	over: boolean;
}

async function readUpTo(
	handle: FileHandle,
	cap: number,
): Promise<Buffer | null> {
	const buf = Buffer.alloc(cap + 1);
	let got = 0;
	while (got <= cap) {
		const { bytesRead } = await handle.read(buf, got, cap + 1 - got, got);
		if (bytesRead === 0) break;
		got += bytesRead;
	}
	return got > cap ? null : buf.subarray(0, got);
}

/**
 * Reads the file only if the object opened is the one checked: the same identity as before
 * the open, one link, and a path still inside the workspace once it is open.
 */
async function readChecked(
	root: string,
	full: string,
	checked: BigIntStats,
	cap: number,
): Promise<Buffer | "link" | "large"> {
	const handle = await open(full, OPEN_FLAGS).catch(() => null);
	if (!handle) return "link";
	try {
		const opened = await handle.stat({ bigint: true });
		const real = await realpath(full).catch(() => null);
		const there = real
			? await lstat(real, { bigint: true }).catch(() => null)
			: null;
		if (
			!opened.isFile() ||
			opened.nlink !== 1n ||
			!sameFile(opened, checked) ||
			!real ||
			!within(root, real) ||
			!there ||
			!sameFile(opened, there)
		)
			return "link";
		if (opened.size > BigInt(cap)) return "large";
		return (await readUpTo(handle, cap)) ?? "large";
	} finally {
		await handle.close();
	}
}

function spend<T extends { patch: string }>(budget: Budget, one: T): T {
	budget.bytes -= Buffer.byteLength(one.patch);
	if (budget.bytes < 0) budget.over = true;
	return one;
}

/** An untracked file as its own patch, read here so git never opens it. */
async function untrackedFile(
	root: string,
	path: string,
	budget: Budget,
): Promise<{ file: WorktreeFile; patch: string }> {
	const entry = (status: WorktreeFile["status"]) => ({
		file: { path, status, additions: null, deletions: null },
		patch: "",
	});
	if (!isSafeRepoPath(path)) return entry("link");
	const full = join(root, path);
	const stat = await lstat(full, { bigint: true }).catch(() => null);
	if (!stat || stat.isSymbolicLink() || !stat.isFile()) return entry("link");
	if (stat.size > BigInt(WORKTREE_FILE_MAX_BYTES)) return entry("added");
	if (Date.now() >= budget.until || stat.size > BigInt(budget.bytes))
		budget.over = true;
	if (budget.over) return entry("added");
	const bytes = await readChecked(
		root,
		full,
		stat,
		Math.min(WORKTREE_FILE_MAX_BYTES, budget.bytes),
	);
	if (bytes === "link") return entry("link");
	if (bytes === "large") {
		budget.over = true;
		return entry("added");
	}
	const head = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
	if (bytes.subarray(0, 8000).includes(0))
		return spend(budget, {
			file: { path, status: "added", additions: null, deletions: null },
			patch: `${head}Binary files /dev/null and b/${path} differ\n`,
		});
	const text = bytes.toString("utf8");
	const lines = text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
	const body = lines.map((l) => `+${l}`).join("\n");
	return spend(budget, {
		file: { path, status: "added", additions: lines.length, deletions: 0 },
		patch: lines.length
			? `${head}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n${
					text.endsWith("\n") ? "" : "\\ No newline at end of file\n"
				}`
			: head,
	});
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
): Promise<WorktreeRepoChanges> {
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
	const until = Date.now() + deadlineMs;
	const objects = await objectsOf(root);
	if (!objects) return gone("not-a-workspace");
	const gitDir = await scratchRepo(root, objects);
	const env = {
		...baseEnv(),
		GIT_DIR: gitDir,
		GIT_WORK_TREE: root,
		GIT_INDEX_FILE: join(gitDir, "index"),
	};
	const git = (args: string[]) =>
		spawnGit(["--no-replace-objects", ...args], {
			cwd: root,
			timeoutMs: READ_TIMEOUT_MS,
			env,
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
		const [counts, statuses, links, others] = await Promise.all([
			git(["diff", "--numstat", "-z", ...diff]).then((r) => numstat(r.stdout)),
			git(["diff", "--name-status", "-z", ...diff]).then((r) =>
				nameStatus(r.stdout),
			),
			git(["ls-files", "-z", "-s"]).then((r) => submodules(r.stdout)),
			git(["ls-files", "-z", "--others", "--exclude-standard"]).then((r) =>
				r.stdout.split("\0").filter(Boolean),
			),
		]);
		const files: WorktreeFile[] = statuses.map(({ path, code }) => {
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
		const patches: string[] = [];
		let tracked = "";
		try {
			tracked = (await git(["diff", ...diff])).stdout;
		} catch {
			tracked = "\0too-large";
		}
		patches.push(tracked);
		const left = RUN_DIFF_MAX_BYTES - Buffer.byteLength(tracked);
		const budget: Budget = {
			bytes: left,
			until,
			over: tracked === "\0too-large" || left < 0,
		};
		for (const path of others.slice(0, WORKTREE_MAX_FILES)) {
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
			const one = await untrackedFile(root, path, budget);
			files.push(one.file);
			if (!budget.over) patches.push(one.patch);
		}
		const tooLarge = budget.over;
		const patch = tooLarge ? "" : patches.join("");
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
			patch: tooLarge ? null : patch,
			omitted: tooLarge ? "too-large" : null,
			truncated: others.length > WORKTREE_MAX_FILES,
		};
	} finally {
		await rm(gitDir, { recursive: true, force: true }).catch(() => {});
	}
}

/** Each recorded repo of the run, in the order the workspace lists them. */
export async function readWorktreeChanges(
	workspace: RunWorkspace | null,
	opts: { roots?: readonly string[]; deadlineMs?: number } = {},
): Promise<WorktreeChanges> {
	const repos: WorktreeRepoChanges[] = [];
	const roots = opts.roots ?? worktreeRoots();
	const deadlineMs = opts.deadlineMs ?? READ_TIMEOUT_MS;
	for (const repo of workspace?.repos ?? [])
		repos.push(await repoChanges(repo, roots, deadlineMs));
	return { repos };
}
