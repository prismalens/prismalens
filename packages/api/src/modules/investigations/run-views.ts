// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The panel's tree and diff reads (#973), out of the same git objects as
 * readEvidenceBlob and behind the same fences: a commit the run recorded, a
 * path that stays inside it, and a diff only for a pair recorded at run start.
 */
import {
	CommitShaSchema,
	isSafeRepoPath,
	RUN_DIFF_MAX_BYTES,
	RUN_TREE_MAX_ENTRIES,
	RUN_TREE_MAX_FILES,
	type RunComparison,
	type RunDiff,
	type RunDiffFile,
	type RunTree,
	type RunTreeEntry,
	type RunWorkspace,
} from "@prismalens/contracts";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { EvidenceRequestRefused, objectDirFor } from "./evidence-blob.js";

const READ_TIMEOUT_MS = 30_000;
// Git for Windows takes "/dev/null" as its null file and refuses os.devNull.
const NULL_FILE = "/dev/null";

/**
 * No config but ours: no system or global file, and the repo's own diff
 * drivers, textconv and submodule expansion overridden on the command line
 * (#973 OBJ-007), so a diff never runs a program or opens another repository.
 */
const LOCKED = [
	"-c",
	"diff.external=",
	"-c",
	"diff.submodule=short",
	"-c",
	`core.attributesFile=${NULL_FILE}`,
	"-c",
	"core.quotePath=false",
	"--no-replace-objects",
];

function gitIn(
	args: string[],
	cwd: string,
	timeoutMs = READ_TIMEOUT_MS,
	signal?: AbortSignal,
) {
	return spawnGit([...LOCKED, ...args], {
		cwd,
		timeoutMs,
		...(signal ? { signal } : {}),
		env: {
			...gitEnv({ source: "none" }),
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: NULL_FILE,
			GIT_LITERAL_PATHSPECS: "1",
		},
	});
}

const git = (args: string[], cwd: string, timeoutMs = READ_TIMEOUT_MS) =>
	gitIn(args, cwd, timeoutMs);

async function usable(dir: string | null): Promise<string | null> {
	if (!dir) return null;
	try {
		await git(["rev-parse", "--git-dir"], dir, GIT_PROBE_TIMEOUT_MS);
		return dir;
	} catch {
		return null;
	}
}

async function hasCommit(dir: string, sha: string): Promise<boolean> {
	try {
		await git(["cat-file", "-e", `${sha}^{commit}`], dir);
		return true;
	} catch {
		return false;
	}
}

const TYPE: Record<string, RunTreeEntry["type"]> = {
	tree: "dir",
	commit: "submodule",
};

/**
 * One directory of a recorded commit, directories first, then git's order;
 * or with `recursive`, every file under it at once (#975 OBJ-012).
 */
export async function readRunTree(
	workspace: RunWorkspace | null,
	sha: string,
	prefix: string | undefined,
	opts: { mirrorRoot?: string; recursive?: boolean } = {},
): Promise<RunTree> {
	if (
		!CommitShaSchema.safeParse(sha).success ||
		(prefix !== undefined && !isSafeRepoPath(prefix))
	)
		throw new EvidenceRequestRefused("Not a commit and path this run can read");
	const repo = workspace?.repos.find((r) => r.head === sha);
	if (!repo)
		throw new EvidenceRequestRefused("This run did not record that commit");
	const at = { repo: repo.name, sha, prefix: prefix ?? null };
	const dir = await usable(objectDirFor(repo, opts.mirrorRoot));
	if (!dir) return { state: "unavailable", ...at, reason: "source-removed" };
	if (!(await hasCommit(dir, sha)))
		return { state: "unavailable", ...at, reason: "commit-gone" };
	if (prefix !== undefined) {
		// The prefix must itself be a directory of the commit; a symlink is a blob.
		const { stdout } = await git(
			["ls-tree", "-z", "--full-tree", sha, "--", prefix],
			dir,
		);
		const self = stdout
			.split("\0")
			.map((l) => /^\d{6} (\w+) [0-9a-f]+\t([\s\S]*)$/.exec(l))
			.find((m) => m?.[2] === prefix);
		if (self?.[1] !== "tree")
			return { state: "unavailable", ...at, reason: "not-a-dir" };
	}
	if (!opts.recursive) {
		const entries = await listLevel(dir, sha, prefix, false);
		const sorted = [
			...entries.filter((e) => e.type === "dir"),
			...entries.filter((e) => e.type !== "dir"),
		];
		return {
			state: "ok",
			...at,
			entries: sorted.slice(0, RUN_TREE_MAX_ENTRIES),
			truncated: sorted.length > RUN_TREE_MAX_ENTRIES,
		};
	}
	// Every file, one top-level folder at a time, so a huge repository is cut at the cap
	// instead of failing past spawnGit's output limit (#975 OBJ-016).
	const files: RunTreeEntry[] = [];
	let truncated = false;
	for (const e of await listLevel(dir, sha, prefix, false)) {
		if (files.length >= RUN_TREE_MAX_FILES) {
			truncated = true;
			break;
		}
		if (e.type !== "dir") {
			files.push(e);
			continue;
		}
		try {
			files.push(...(await listLevel(dir, sha, e.path, true)));
		} catch {
			truncated = true;
			break;
		}
	}
	return {
		state: "ok",
		...at,
		entries: files.slice(0, RUN_TREE_MAX_FILES),
		truncated: truncated || files.length > RUN_TREE_MAX_FILES,
	};
}

async function listLevel(
	dir: string,
	sha: string,
	prefix: string | undefined,
	recursive: boolean,
): Promise<RunTreeEntry[]> {
	const { stdout } = await git(
		[
			"ls-tree",
			"-z",
			"--full-tree",
			...(recursive ? ["-r"] : []),
			sha,
			"--",
			...(prefix ? [`${prefix}/`] : []),
		],
		dir,
	);
	const entries: RunTreeEntry[] = [];
	for (const line of stdout.split("\0")) {
		const m = /^(\d{6}) (\w+) [0-9a-f]+\t([\s\S]*)$/.exec(line);
		if (!m) continue;
		const [, mode, type, path] = m as unknown as [
			string,
			string,
			string,
			string,
		];
		entries.push({
			name: path.slice(path.lastIndexOf("/") + 1),
			path,
			type: TYPE[type] ?? (mode === "120000" ? "symlink" : "file"),
		});
	}
	return entries;
}

type Run = (args: string[]) => ReturnType<typeof gitIn>;

async function isAncestor(git: Run, a: string, b: string) {
	try {
		await git(["merge-base", "--is-ancestor", a, b]);
		return true;
	} catch {
		return false;
	}
}

async function tagAt(git: Run, sha: string): Promise<string | null> {
	const { stdout } = await git([
		"tag",
		"--points-at",
		sha,
		"--sort=-creatordate",
	]);
	return stdout.split("\n").find(Boolean) ?? null;
}

async function kindOf(git: Run, sha: string) {
	const { stdout } = await git(["rev-list", "--parents", "-n", "1", sha]);
	return stdout.trim().split(" ").length > 2 ? "merge" : "commit";
}

/**
 * The pair the panel may diff, recorded at run start (#973 OBJ-001/002):
 * the newest recorded deployment in the head's history against the one
 * before it; else the newest tag against the tag before it; else the head
 * against its first parent. Each end keeps the word for what it is.
 */
export async function compareFor(
	dir: string,
	repo: string,
	head: string,
	deployments: { sha: string; name: string | null }[],
	signal?: AbortSignal,
): Promise<RunComparison | null> {
	try {
		return await pairFor(dir, repo, head, deployments, signal);
	} catch (error) {
		// Out of time or cancelled: the run goes on without a comparison (#975 OBJ-014).
		if (signal?.aborted) return null;
		throw error;
	}
}

async function pairFor(
	dir: string,
	repo: string,
	head: string,
	deployments: { sha: string; name: string | null }[],
	signal?: AbortSignal,
): Promise<RunComparison | null> {
	signal?.throwIfAborted();
	const git = (args: string[]) => gitIn(args, dir, READ_TIMEOUT_MS, signal);
	const between = async (base: string, tip: string) =>
		Number(
			(await git(["rev-list", "--count", `${base}..${tip}`])).stdout.trim(),
		);
	const known: { sha: string; name: string | null }[] = [];
	for (const d of deployments) {
		if (!CommitShaSchema.safeParse(d.sha).success) continue;
		if (known.some((k) => k.sha === d.sha)) continue;
		if (await isAncestor(git, d.sha, known[0]?.sha ?? head)) known.push(d);
		if (known.length === 2) break;
	}
	const [tip, prev] = known;
	if (tip && prev && tip.sha !== prev.sha)
		return {
			repo,
			head: tip.sha,
			headKind: "deployment",
			headName: tip.name,
			base: prev.sha,
			baseKind: "deployment",
			baseName: prev.name,
			between: await between(prev.sha, tip.sha),
		};

	const tag = await tagAt(git, head);
	if (tag) {
		try {
			const { stdout } = await git([
				"describe",
				"--tags",
				"--abbrev=0",
				`${head}^`,
			]);
			const prevTag = stdout.trim();
			const base = (
				await git(["rev-list", "-n", "1", `refs/tags/${prevTag}`])
			).stdout.trim();
			if (CommitShaSchema.safeParse(base).success)
				return {
					repo,
					head,
					headKind: "tag",
					headName: tag,
					base,
					baseKind: "tag",
					baseName: prevTag,
					between: await between(base, head),
				};
		} catch {
			// No earlier tag: the parent below.
		}
	}

	let parent: string;
	try {
		parent = (await git(["rev-parse", "--verify", `${head}^1`])).stdout.trim();
	} catch {
		return null;
	}
	return {
		repo,
		head,
		headKind: tag ? "tag" : await kindOf(git, head),
		headName: tag,
		base: parent,
		baseKind: await kindOf(git, parent),
		baseName: null,
		between: 1,
	};
}

function numstat(out: string): RunDiffFile[] {
	// -z numstat: "add\tdel\tpath\0", or "add\tdel\t\0old\0new\0" for a rename.
	const parts = out.split("\0");
	const files: RunDiffFile[] = [];
	for (let i = 0; i < parts.length; i++) {
		const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[i] ?? "");
		if (!m) continue;
		const [, a, d, path] = m as unknown as [string, string, string, string];
		const counts = {
			additions: a === "-" ? null : Number(a),
			deletions: d === "-" ? null : Number(d),
		};
		if (path === "") {
			const oldPath = parts[++i] ?? "";
			const newPath = parts[++i] ?? "";
			files.push({ path: newPath, oldPath, ...counts });
		} else files.push({ path, oldPath: null, ...counts });
	}
	return files;
}

/** The recorded pair at `pair`, narrowed to `path` when given. */
export async function readRunDiff(
	workspace: RunWorkspace | null,
	pair: number,
	path: string | undefined,
	opts: { mirrorRoot?: string } = {},
): Promise<RunDiff> {
	if (path !== undefined && !isSafeRepoPath(path))
		throw new EvidenceRequestRefused("Not a path this run can read");
	const comparison = workspace?.compare?.[pair];
	const repo = comparison
		? workspace?.repos.find((r) => r.name === comparison.repo)
		: undefined;
	if (!comparison || !repo)
		throw new EvidenceRequestRefused("This run recorded no such comparison");
	const dir = await usable(objectDirFor(repo, opts.mirrorRoot));
	if (!dir)
		return { state: "unavailable", comparison, reason: "source-removed" };
	if (
		!(await hasCommit(dir, comparison.base)) ||
		!(await hasCommit(dir, comparison.head))
	)
		return { state: "unavailable", comparison, reason: "commit-gone" };
	const range = [
		"--src-prefix=a/",
		"--dst-prefix=b/",
		"--no-ext-diff",
		"--no-textconv",
		"--submodule=short",
		"--no-color",
		"-M",
		comparison.base,
		comparison.head,
		"--",
		...(path ? [path] : []),
	];
	const files = numstat(
		(await git(["diff", "--numstat", "-z", ...range], dir)).stdout,
	);
	try {
		const { stdout } = await git(["diff", ...range], dir);
		if (Buffer.byteLength(stdout) > RUN_DIFF_MAX_BYTES)
			return {
				state: "ok",
				comparison,
				files,
				patch: null,
				omitted: "too-large",
			};
		return { state: "ok", comparison, files, patch: stdout, omitted: null };
	} catch {
		// Past spawnGit's own output cap.
		return {
			state: "ok",
			comparison,
			files,
			patch: null,
			omitted: "too-large",
		};
	}
}
