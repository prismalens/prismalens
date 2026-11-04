// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's live worktree against the commit recorded at workspace creation (#1020).
 * Git runs on a throwaway GIT_DIR, index and config of ours, so nothing the agent writes in
 * the repo's config or attributes can name a program, and the repo's index is never written.
 */
import { mkdirSync } from "node:fs";
import {
	lstat,
	mkdtemp,
	open,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
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
				env: gitEnv({ source: "none" }),
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
	await writeFile(join(gitDir, "config"), await mirrored(dir));
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

/** An untracked file as its own patch, read here so git never opens it. */
async function untrackedFile(
	root: string,
	path: string,
): Promise<{ file: WorktreeFile; patch: string }> {
	const entry = (status: WorktreeFile["status"]) => ({
		file: { path, status, additions: null, deletions: null },
		patch: "",
	});
	if (!isSafeRepoPath(path)) return entry("link");
	const full = join(root, path);
	const stat = await lstat(full).catch(() => null);
	if (!stat || stat.isSymbolicLink() || !stat.isFile()) return entry("link");
	const real = await realpath(full).catch(() => null);
	if (!real?.startsWith(root + sep)) return entry("link");
	if (stat.size > WORKTREE_FILE_MAX_BYTES) return entry("added");
	// The agent may delete or lock the file between the listing and here; list it without lines.
	const handle = await open(real, "r").catch(() => null);
	if (!handle) return entry("added");
	let bytes: Buffer;
	try {
		bytes = await handle.readFile();
	} catch {
		return entry("added");
	} finally {
		await handle.close();
	}
	const head = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
	if (bytes.subarray(0, 8000).includes(0))
		return {
			file: { path, status: "added", additions: null, deletions: null },
			patch: `${head}Binary files /dev/null and b/${path} differ\n`,
		};
	const text = bytes.toString("utf8");
	const lines = text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
	const body = lines.map((l) => `+${l}`).join("\n");
	return {
		file: { path, status: "added", additions: lines.length, deletions: 0 },
		patch: lines.length
			? `${head}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n${
					text.endsWith("\n") ? "" : "\\ No newline at end of file\n"
				}`
			: head,
	};
}

/** Gitlinks of the base tree: listed by path, never opened. */
function submodules(out: string): string[] {
	return out
		.split("\0")
		.map((l) => /^160000 [0-9a-f]+ \d\t([\s\S]+)$/.exec(l)?.[1])
		.filter((p): p is string => !!p);
}

async function repoChanges(repo: Repo): Promise<WorktreeRepoChanges> {
	const gone = (reason: "removed" | "not-a-workspace" | "commit-gone") =>
		({ state: "unavailable", repo: repo.name, reason }) as const;
	if (!isAbsolute(repo.dir)) return gone("not-a-workspace");
	const stat = await lstat(repo.dir).catch(() => null);
	if (!stat) return gone("removed");
	// A junction or symlink where the workspace was is not the workspace the server made.
	if (stat.isSymbolicLink() || !stat.isDirectory())
		return gone("not-a-workspace");
	if (!CommitShaSchema.safeParse(repo.head).success) return gone("commit-gone");
	const root = await realpath(repo.dir);
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
		let patchBytes = Buffer.byteLength(tracked);
		let overCap = patchBytes > RUN_DIFF_MAX_BYTES;
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
			const one = await untrackedFile(root, path);
			files.push(one.file);
			// Past the cap the patch is dropped anyway: keep listing files, stop holding text.
			if (!overCap) {
				patchBytes += Buffer.byteLength(one.patch);
				if (patchBytes > RUN_DIFF_MAX_BYTES) {
					overCap = true;
					patches.length = 0;
				} else patches.push(one.patch);
			}
		}
		const patch = patches.join("");
		const tooLarge = tracked === "\0too-large" || overCap;
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
): Promise<WorktreeChanges> {
	const repos: WorktreeRepoChanges[] = [];
	for (const repo of workspace?.repos ?? [])
		repos.push(await repoChanges(repo));
	return { repos };
}
