// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread's diff by scope, one file's text, and revert (#1101 category 16). Both ends of a
 * diff are commits in the snapshot store, resolved here, never named by the client. Every
 * mutation sets paths from the exact state the user was shown to a state the store holds.
 */
import { lstat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
	type DiffScope,
	isSafeRepoPath,
	type RevertBlock,
	type RevertChangesInput,
	type RevertChangesResult,
	RUN_DIFF_MAX_BYTES,
	type RunWorkspace,
	WORKTREE_FILE_MAX_BYTES,
	type WorktreeChanges,
	type WorktreeFile,
	type WorktreeFileContent,
	type WorktreeRepoChanges,
} from "@prismalens/contracts";
import {
	WORKTREE_PREFIX,
	worktreeRoots,
} from "../../core/harness/run-worktree.js";
import {
	linkedPath,
	nameStatus,
	numstat,
	samePath,
} from "./worktree-changes.js";
import {
	changedPaths,
	forgetNow,
	interruptedReverts,
	nowSnapshot,
	openStore,
	REVERT_REF,
	type SnapshotStore,
	SnapshotUnavailable,
	sameRoot,
	scratchIndex,
	skippedOf,
	statesAt,
	TURN_REF,
	takeSnapshot,
	turnSnapshots,
	withStoreLock,
	worktreeHead,
} from "./worktree-snapshots.js";

const DIFF = [
	"--no-ext-diff",
	"--no-textconv",
	"--ignore-submodules=all",
	"--no-renames",
	"--no-color",
	"--src-prefix=a/",
	"--dst-prefix=b/",
];

export interface ScopeContext {
	runId: string;
	/** A turn is running now. */
	running: boolean;
	/** The device may change files (`investigate:operate`). */
	canWrite: boolean;
	roots?: readonly string[];
}

function rootsOf(ws: RunWorkspace, ctx: ScopeContext): readonly string[] {
	const borrowed = ws.layout === "in_place" ? ws.borrowed?.path : undefined;
	return borrowed ? [join(borrowed, "..")] : (ctx.roots ?? worktreeRoots());
}

function blockOf(ws: RunWorkspace, ctx: ScopeContext): RevertBlock | null {
	if (ws.layout === "in_place") return "borrowed";
	if (ws.layout === "folder") return "folder";
	if (!ctx.canWrite) return "view-only";
	if (ctx.running) return "running";
	return null;
}

const unavailable = (
	repo: string,
	reason: Extract<WorktreeRepoChanges, { state: "unavailable" }>["reason"],
): WorktreeRepoChanges => ({ state: "unavailable", repo, reason });

function reasonOf(e: unknown) {
	if (e instanceof SnapshotUnavailable)
		return e.reason === "unsupported" ? "not-a-workspace" : e.reason;
	return "commit-gone" as const;
}

interface Ends {
	from: string;
	to: string;
	turn: number | null;
	live: boolean;
}

/** The scope's two commits; null when the run has no snapshot for it. */
async function endsOf(
	store: SnapshotStore,
	scope: DiffScope,
	turn: number | undefined,
	now: string,
): Promise<Ends | null> {
	const head = (await store.git(["rev-parse", `${now}^`])).trim();
	if (scope === "uncommitted")
		return { from: head, to: now, turn: null, live: false };
	if (scope === "all") {
		const base = await store
			.git(["merge-base", store.repo.head, head])
			.then((o) => o.trim())
			.catch(() => store.repo.head);
		return { from: base || store.repo.head, to: now, turn: null, live: false };
	}
	const turns = await turnSnapshots(store);
	if (scope === "turn") {
		const t =
			turn === undefined
				? turns.findLast((x) => x.start)
				: turns.find((x) => x.seq === turn);
		if (!t?.start) return null;
		return { from: t.start, to: t.end ?? now, turn: t.seq, live: !t.end };
	}
	// Outside turns: the files changed between or after them, each against the base (#1101 category 16).
	if (!turns.some((x) => x.end)) return null;
	return endsOf(store, "all", undefined, now);
}

/** Paths changed outside the agent's turns: in each gap between them, and after the last. */
async function outsidePaths(
	store: SnapshotStore,
	now: string,
): Promise<string[]> {
	const turns = await turnSnapshots(store);
	const out = new Set<string>();
	for (let i = 0; i < turns.length; i++) {
		const end = turns[i]?.end;
		if (!end) continue;
		const nextStart = turns.slice(i + 1).find((t) => t.start)?.start ?? now;
		for (const p of await changedPaths(store, end, nextStart)) out.add(p);
	}
	return [...out];
}

async function repoScoped(
	ws: RunWorkspace,
	i: number,
	scope: DiffScope,
	turn: number | undefined,
	ctx: ScopeContext,
): Promise<WorktreeRepoChanges> {
	const repo = ws.repos[i] as RunWorkspace["repos"][number];
	let store: SnapshotStore;
	try {
		store = await openStore(ctx.runId, i, repo, rootsOf(ws, ctx));
	} catch (e) {
		return unavailable(repo.name, reasonOf(e));
	}
	try {
		const now = await nowSnapshot(store);
		const ends = await endsOf(store, scope, turn, now.commit);
		if (!ends) return unavailable(repo.name, "no-snapshot");
		const { from, to } = ends;
		const outside = await outsidePaths(store, now.commit);
		// No outside path: an empty pathspec would mean every path.
		const only =
			scope === "outside"
				? outside.length
					? ["--", ...outside]
					: ["--", ":(exclude,top)*"]
				: [];
		const [statuses, counts] = await Promise.all([
			store
				.git(["diff", "--name-status", "-z", ...DIFF, from, to, ...only], {
					magic: only.length > 0 && !outside.length,
				})
				.then(nameStatus),
			store
				.git(["diff", "--numstat", "-z", ...DIFF, from, to, ...only], {
					magic: only.length > 0 && !outside.length,
				})
				.then(numstat),
		]);
		const files: WorktreeFile[] = statuses.map(({ path, code }) => {
			const [additions, deletions] = counts.get(path) ?? [null, null];
			return {
				path,
				status: code.startsWith("D")
					? "deleted"
					: code.startsWith("A")
						? "added"
						: "modified",
				additions,
				deletions,
			};
		});
		let patch: string | null = (
			await store.git(["diff", "--full-index", ...DIFF, from, to, ...only], {
				magic: only.length > 0 && !outside.length,
			})
		).toString();
		if (Buffer.byteLength(patch) > RUN_DIFF_MAX_BYTES) patch = null;
		const toMessage = await store.git(["log", "-1", "--format=%B", to]);
		const skipped = skippedOf(toMessage.trim());
		for (const p of skipped)
			if (!files.some((f) => f.path === p))
				files.push({
					path: p,
					status: "link",
					additions: null,
					deletions: null,
				});
		const states = await statesAt(
			store,
			to,
			files.filter((f) => f.status !== "link").map((f) => f.path),
		);
		const sum = (k: "additions" | "deletions") =>
			files.reduce((n, f) => n + (f[k] ?? 0), 0);
		const turns = await turnSnapshots(store);
		return {
			state: "ok",
			repo: repo.name,
			base: repo.head,
			branch: repo.branch,
			files,
			additions: sum("additions"),
			deletions: sum("deletions"),
			patch,
			omitted: patch === null ? "too-large" : null,
			truncated: false,
			scoped: {
				scope,
				from,
				to,
				turn: ends.turn,
				live: ends.live,
				states: Object.fromEntries(states),
				outside,
				skipped,
				turns: turns
					.filter((t) => t.start)
					.map((t) => ({ seq: t.seq, ended: !!t.end })),
				revert: blockOf(ws, ctx),
				interrupted: await interruptedReverts(store),
			},
		};
	} catch (e) {
		return unavailable(repo.name, reasonOf(e));
	}
}

/** Each repo of the run's workspace, diffed for one scope. */
export async function readScopedChanges(
	ws: RunWorkspace | null,
	scope: DiffScope,
	turn: number | undefined,
	ctx: ScopeContext,
): Promise<WorktreeChanges> {
	const repos: WorktreeRepoChanges[] = [];
	if (!ws || ws.layout === "folder") return { repos };
	for (let i = 0; i < ws.repos.length; i++)
		repos.push(await repoScoped(ws, i, scope, turn, ctx));
	return { repos };
}

/**
 * Takes the start or end snapshot of a turn in every repo of the run (#1101 category 16).
 * The start shares the store's lock with reverts, so no turn starts while one writes.
 */
export async function snapshotTurn(
	ws: RunWorkspace | null,
	runId: string,
	phase: "start" | "end",
	turnId: number,
	signal: AbortSignal,
	roots?: readonly string[],
): Promise<void> {
	if (!ws || ws.layout === "folder") return;
	const ctx: ScopeContext = {
		runId,
		running: false,
		canWrite: false,
		...(roots ? { roots } : {}),
	};
	for (let i = 0; i < ws.repos.length; i++) {
		if (signal.aborted) return;
		const repo = ws.repos[i] as RunWorkspace["repos"][number];
		const store = await openStore(runId, i, repo, rootsOf(ws, ctx));
		await withStoreLock(store.gitDir, async () => {
			forgetNow(store);
			await takeSnapshot(store, {
				ref: `${TURN_REF}/${turnId}/${phase}`,
				signal,
			});
		});
	}
}

/** One file's text at a commit of the store that a snapshot reaches. */
export async function readChangesFile(
	ws: RunWorkspace | null,
	runId: string,
	repoName: string,
	commit: string,
	path: string,
	roots?: readonly string[],
): Promise<WorktreeFileContent> {
	const i = ws?.repos.findIndex((r) => r.name === repoName) ?? -1;
	if (!ws || i < 0 || !isSafeRepoPath(path))
		return { state: "unavailable", reason: "no-workspace" };
	const ctx: ScopeContext = {
		runId,
		running: false,
		canWrite: false,
		...(roots ? { roots } : {}),
	};
	try {
		const store = await openStore(
			runId,
			i,
			ws.repos[i] as RunWorkspace["repos"][number],
			rootsOf(ws, ctx),
		);
		// Only a snapshot, or a commit a snapshot reaches: never any object the alternates hold.
		const now = await nowSnapshot(store);
		const tips = [
			now.commit,
			...(
				await store.git(["for-each-ref", "--format=%(objectname)", "refs/pl"])
			)
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean),
		];
		// Our own snapshot commits (a past "now" has no ref), or any commit a ref of ours reaches.
		const note = await store
			.git(["log", "-1", "--format=%s", commit])
			.then((o) => o.trim())
			.catch(() => "");
		let reached =
			note === "PrismaLens snapshot" || note.startsWith("PrismaLens revert");
		for (const tip of reached ? [] : tips) {
			reached = await store
				.git(["merge-base", "--is-ancestor", commit, tip])
				.then(() => true)
				.catch(() => false);
			if (reached) break;
		}
		if (!reached) return { state: "unavailable", reason: "no-workspace" };
		const size = Number(
			(
				await store.git(["cat-file", "-s", `${commit}:${path}`]).catch(() => "")
			).trim(),
		);
		if (!Number.isFinite(size) || size <= 0)
			return size === 0
				? { state: "ok", contents: "" }
				: { state: "unavailable", reason: "absent" };
		if (size > WORKTREE_FILE_MAX_BYTES)
			return { state: "unavailable", reason: "too-large" };
		const text = await store.git(["cat-file", "blob", `${commit}:${path}`]);
		if (text.slice(0, 8000).includes("\0"))
			return { state: "unavailable", reason: "binary" };
		return { state: "ok", contents: text };
	} catch {
		return { state: "unavailable", reason: "no-workspace" };
	}
}

/** `<location>/pl-<runId>`, or a repo folder directly inside it for a multi-repo run. */
function ownedBy(
	root: string,
	runId: string,
	roots: readonly string[],
): boolean {
	const own = `${WORKTREE_PREFIX}${runId}`;
	const up = dirname(root);
	const inRoot = (d: string) => roots.some((r) => samePath(resolve(r), d));
	return (
		(basename(root) === own && inRoot(up)) ||
		(basename(up) === own && inRoot(dirname(up)))
	);
}

const refused = (
	reason: Extract<RevertChangesResult, { state: "refused" }>["reason"],
	paths: string[] = [],
	block: RevertBlock | null = null,
): RevertChangesResult => ({ state: "refused", reason, paths, block });

const REGULAR = /^(100644|100755) [0-9a-f]+$/;

/** The one hunk whose header the user saw, re-cut from a patch of one file. */
function oneHunk(patch: string, header: string): string | null {
	const at = patch.indexOf("\n@@");
	if (at < 0) return null;
	const head = patch.slice(0, at + 1);
	const hunks = patch.slice(at + 1).split(/\n(?=@@ )/);
	const hit = hunks.filter((h) => h.split("\n")[0]?.startsWith(header.trim()));
	if (hit.length !== 1) return null;
	const body = (hit[0] as string).endsWith("\n") ? hit[0] : `${hit[0]}\n`;
	return head + body;
}

/**
 * Revert a file, a hunk or a turn, or undo a revert, in the thread's own worktree. Refuses
 * unless every path still holds the state the user was shown; writes only after a journal.
 */
export async function revertChanges(
	ws: RunWorkspace | null,
	input: RevertChangesInput,
	ctx: ScopeContext,
): Promise<RevertChangesResult> {
	if (!ws) return refused("unavailable");
	const block = blockOf(ws, ctx);
	if (block) return refused("blocked", [], block);
	const i = ws.repos.findIndex((r) => r.name === input.repo);
	if (i < 0) return refused("unavailable");
	let store: SnapshotStore;
	try {
		store = await openStore(
			input.id,
			i,
			ws.repos[i] as RunWorkspace["repos"][number],
			rootsOf(ws, ctx),
		);
	} catch {
		return refused("unavailable");
	}
	// Only the run's own worktree: `pl-<runId>` under a worktree location.
	if (!ownedBy(store.root, input.id, rootsOf(ws, ctx)))
		return refused("blocked", [], "borrowed");
	return withStoreLock(store.gitDir, async () => {
		forgetNow(store);
		const id = String(Date.now());
		const before = await takeSnapshot(store, {
			ref: `${REVERT_REF}/${id}/before`,
		});
		const t = input.target;
		// A = the state each path must still hold; B = the state it is set to.
		let paths: string[];
		let want: Map<string, string>;
		let next: Map<string, string>;
		/** The commits A and B come from: their skipped lists bar those paths too. */
		let sources: string[];
		if (t.kind === "undo") {
			const ref = (k: string) =>
				store
					.git([
						"rev-parse",
						"--verify",
						"-q",
						`${REVERT_REF}/${t.revertId}/${k}`,
					])
					.then((o) => o.trim())
					.catch(() => "");
			const [b, target] = [await ref("before"), await ref("target")];
			if (!b || !target) return refused("no-snapshot");
			paths = await changedPaths(store, b, target);
			want = await statesAt(store, target, paths);
			next = await statesAt(store, b, paths);
			sources = [b];
		} else if (t.kind === "turn") {
			const turn = (await turnSnapshots(store)).find((x) => x.seq === t.seq);
			if (!turn?.start || !turn.end) return refused("no-snapshot");
			paths = await changedPaths(store, turn.start, turn.end);
			want = await statesAt(store, turn.end, paths);
			next = await statesAt(store, turn.start, paths);
			sources = [turn.start, turn.end];
		} else {
			const ends = await endsOf(store, input.scope, input.turn, before.commit);
			if (!ends || ends.from !== input.from) return refused("stale", [t.path]);
			paths = [t.path];
			want = new Map([[t.path, input.expect[t.path] ?? "missing"]]);
			next = await statesAt(store, ends.from, paths);
			sources = [ends.from];
			if (t.kind === "hunk") {
				const a = want.get(t.path) ?? "";
				const b = next.get(t.path) ?? "";
				if (
					!REGULAR.test(a) ||
					!REGULAR.test(b) ||
					a.slice(0, 6) !== b.slice(0, 6)
				)
					return refused("not-a-hunk", paths);
			}
		}
		if (!paths.length) return refused("no-snapshot");
		const ends_skipped: string[] = [];
		for (const c of sources)
			ends_skipped.push(
				...skippedOf((await store.git(["log", "-1", "--format=%B", c])).trim()),
			);
		const now = await statesAt(store, before.commit, paths);
		// A path any endpoint left out was never captured: nothing may be set from it.
		const skipped = new Set([...before.skipped, ...ends_skipped]);
		const linked = paths.filter((p) => skipped.has(p) || !isSafeRepoPath(p));
		if (linked.length) return refused("linked", linked);
		// A path already at B is done (an interrupted revert's restore); one at neither A nor B moved.
		const moved = paths.filter(
			(p) => now.get(p) !== want.get(p) && now.get(p) !== next.get(p),
		);
		if (moved.length)
			return refused(
				t.kind === "turn" || t.kind === "undo" ? "conflict" : "stale",
				moved,
			);
		paths = paths.filter(
			(p) => now.get(p) !== next.get(p) || t.kind === "hunk",
		);
		if (!paths.length) return refused("no-snapshot");
		for (const p of paths)
			if ((await linkedPath(store.root, p)) || (await collides(store.root, p)))
				return refused("linked", [p]);
		const idx = await scratchIndex();
		try {
			const work = { work: true, index: idx.path } as const;
			await store.git(["read-tree", before.commit], { index: idx.path });
			if (t.kind === "hunk") {
				const patch = await store.git([
					"diff",
					"--full-index",
					...DIFF,
					input.from,
					before.commit,
					"--",
					t.path,
				]);
				const one = oneHunk(patch, t.header);
				if (!one) return refused("stale", paths);
				await store
					.git(["apply", "--cached", "-R", "--whitespace=nowarn", "-"], {
						index: idx.path,
						input: one,
					})
					.catch(() => {
						throw new HunkConflict();
					});
			} else {
				for (const p of paths) {
					const b = next.get(p) ?? "absent";
					if (b === "absent")
						await store.git(["update-index", "--force-remove", "--", p], {
							index: idx.path,
						});
					else {
						const [mode, oid] = b.split(" ");
						await store.git(
							["update-index", "--add", "--cacheinfo", `${mode},${oid},${p}`],
							{ index: idx.path },
						);
					}
				}
			}
			const tree = (
				await store.git(["write-tree"], { index: idx.path })
			).trim();
			const final = await statesAt(store, tree, paths);
			const head = await worktreeHead(store);
			const target = (
				await store.git(["commit-tree", tree, "-p", head, "-F", "-"], {
					input: `PrismaLens revert ${id}\n`,
				})
			).trim();
			// Every blob is checked present before the first write: a pruned object fails here, not halfway.
			for (const st of final.values())
				if (st !== "absent")
					await store
						.git(["cat-file", "-e", st.split(" ")[1] as string])
						.catch(() => {
							throw new SnapshotUnavailable("commit-gone");
						});
			// The journal is down before the first write: an interrupted revert can be undone.
			await store.git(["update-ref", `${REVERT_REF}/${id}/target`, target]);
			await sameRoot(store);
			for (const p of paths) {
				if (final.get(p) === "absent") {
					if (!(await linkedPath(store.root, p)))
						await unlink(join(store.root, p)).catch(() => {});
					continue;
				}
				await store.git(["checkout-index", "-f", "--", p], work);
			}
			await takeSnapshot(store, { ref: `${REVERT_REF}/${id}/after` });
			return {
				state: "done",
				revertId: id,
				paths,
			} satisfies RevertChangesResult;
		} catch (e) {
			if (e instanceof HunkConflict) return refused("stale", paths);
			throw e;
		} finally {
			await idx.done();
		}
	});
}

class HunkConflict extends Error {}

/**
 * Whether writing a file at `path` would replace a directory, or need a directory where a
 * file stands: `checkout-index -f` would remove either, ignored contents included.
 */
async function collides(root: string, path: string): Promise<boolean> {
	const parts = path.split("/");
	let at = root;
	for (const [i, part] of parts.entries()) {
		at = join(at, part);
		const st = await lstat(at).catch(() => null);
		if (!st) return false;
		if (i < parts.length - 1 ? !st.isDirectory() : st.isDirectory())
			return true;
	}
	return false;
}
