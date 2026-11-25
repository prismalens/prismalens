// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread's diff by scope, one file's text, and revert (#1101 category 16). Both ends of a
 * diff are commits in the snapshot store, resolved here, never named by the client. Every
 * mutation sets paths from the exact state the user was shown to a state the store holds.
 */
import { realpathSync } from "node:fs";
import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	type DiffScope,
	isSafeRepoPath,
	type KeepWhy,
	REWIND_PATHS_MAX,
	type RevertBlock,
	type RevertChangesInput,
	type RevertChangesResult,
	type RewindRepoPreview,
	RUN_DIFF_MAX_BYTES,
	type RunWorkspace,
	WORKTREE_FILE_MAX_BYTES,
	type WorktreeChanges,
	type WorktreeFile,
	type WorktreeFileContent,
	type WorktreePatch,
	type WorktreeRepoChanges,
} from "@prismalens/contracts";
import * as clock from "../../core/clock.js";
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
	nowSnapshot,
	nowWithRefs,
	OP_REF,
	openStore,
	REVERT_REF,
	type Snapshot,
	type SnapshotStore,
	SnapshotUnavailable,
	sameRoot,
	scratchIndex,
	skippedOf,
	statesAt,
	storeGit,
	TURN_REF,
	type TurnSnapshot,
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
	known: { turns?: TurnSnapshot[]; head?: string } = {},
): Promise<Ends | null> {
	const head = known.head ?? (await store.git(["rev-parse", `${now}^`])).trim();
	if (scope === "uncommitted")
		return { from: head, to: now, turn: null, live: false };
	if (scope === "all") {
		// A HEAD still at the recorded commit is its own merge base: no git process.
		const base =
			head === store.repo.head
				? head
				: await store
						.git(["merge-base", store.repo.head, head])
						.then((o) => o.trim())
						.catch(() => store.repo.head);
		return { from: base || store.repo.head, to: now, turn: null, live: false };
	}
	const turns = known.turns ?? (await turnSnapshots(store));
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
	return endsOf(store, "all", undefined, now, { turns, head });
}

/** Paths changed outside the agent's turns: in each gap between them, and after the last. */
async function outsidePaths(
	store: SnapshotStore,
	now: string,
	turns: TurnSnapshot[],
): Promise<string[]> {
	const out = new Set<string>();
	for (let i = 0; i < turns.length; i++) {
		const end = turns[i]?.end;
		if (!end) continue;
		const nextStart = turns.slice(i + 1).find((t) => t.start)?.start ?? now;
		for (const p of await changedPaths(store, end, nextStart)) out.add(p);
	}
	return [...out];
}

/**
 * A summary's files and counts between two snapshots, kept by their trees: a "now" snapshot
 * of an unchanged workspace is a new commit with the same tree, so the diff's next read
 * skips git's content diff over every changed file (#1101 category 12, the diff's first
 * content). A changed file is a new tree and a fresh read.
 */
const between = new Map<string, WorktreeFile[]>();
const BETWEEN_MAX = 32;

async function filesBetween(
	store: SnapshotStore,
	scope: DiffScope,
	from: string,
	to: string,
	only: readonly string[],
	o: { magic: boolean; keep: boolean },
): Promise<WorktreeFile[]> {
	const key = o.keep
		? [
				store.gitDir,
				scope,
				(await store.git(["rev-parse", `${from}^{tree}`, `${to}^{tree}`]))
					.trim()
					.replace(/\s+/g, " "),
				...only,
			].join("\0")
		: null;
	// The last summary also sits in the run's own store, so a restarted server has it.
	const file = join(store.gitDir, "pl-between.json");
	const kept =
		key === null
			? undefined
			: (between.get(key) ??
				(await readFile(file, "utf8")
					.then(
						(t) => JSON.parse(t) as { key?: string; files?: WorktreeFile[] },
					)
					.then((j) => (j.key === key ? j.files : undefined))
					.catch(() => undefined)));
	if (kept) {
		if (key) between.set(key, kept);
		return kept.map((f) => ({ ...f }));
	}
	const [statuses, counts] = await Promise.all([
		store
			.git(["diff", "--name-status", "-z", ...DIFF, from, to, ...only], {
				magic: o.magic,
			})
			.then(nameStatus),
		store
			.git(["diff", "--numstat", "-z", ...DIFF, from, to, ...only], {
				magic: o.magic,
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
	if (key) {
		if (between.size >= BETWEEN_MAX) {
			const oldest = between.keys().next().value;
			if (oldest !== undefined) between.delete(oldest);
		}
		between.set(
			key,
			files.map((f) => ({ ...f })),
		);
		await writeFile(file, JSON.stringify({ key, files })).catch(() => {});
	}
	return files;
}

/**
 * The whole run's summary, worked out when a turn ends, so the diff a person opens next
 * reads it kept instead of diffing every changed file then (#1101 category 12).
 */
async function warmSummary(store: SnapshotStore, end: string): Promise<void> {
	const ends = await endsOf(store, "all", undefined, end);
	if (!ends) return;
	await filesBetween(store, "all", ends.from, ends.to, [], {
		magic: false,
		keep: true,
	});
}

async function repoScoped(
	ws: RunWorkspace,
	i: number,
	scope: DiffScope,
	turn: number | undefined,
	ctx: ScopeContext,
	withPatch: boolean,
): Promise<WorktreeRepoChanges> {
	const repo = ws.repos[i] as RunWorkspace["repos"][number];
	let store: SnapshotStore;
	try {
		store = await openStore(ctx.runId, i, repo, rootsOf(ws, ctx));
	} catch (e) {
		return unavailable(repo.name, reasonOf(e));
	}
	try {
		// The refs are read once, under the lock the snapshot is taken in, so the two agree.
		const { now, refs } = await nowWithRefs(store);
		const ends = await endsOf(store, scope, turn, now.commit, {
			turns: refs.turns,
			head: now.head,
		});
		if (!ends) return unavailable(repo.name, "no-snapshot");
		const { from, to } = ends;
		const outside = await outsidePaths(store, now.commit, refs.turns);
		// No outside path: an empty pathspec would mean every path.
		const only =
			scope === "outside"
				? outside.length
					? ["--", ...outside]
					: ["--", ":(exclude,top)*"]
				: [];
		const magic = only.length > 0 && !outside.length;
		const [files, fullPatch, toMessage] = await Promise.all([
			filesBetween(store, scope, from, to, only, { magic, keep: !withPatch }),
			withPatch
				? store.git(["diff", "--full-index", ...DIFF, from, to, ...only], {
						magic,
					})
				: null,
			store.git(["log", "-1", "--format=%B", to]),
		]);
		let patch: string | null = fullPatch === null ? null : fullPatch.toString();
		if (patch !== null && Buffer.byteLength(patch) > RUN_DIFF_MAX_BYTES)
			patch = null;
		const skipped = skippedOf(toMessage.trim());
		for (const p of skipped)
			if (!files.some((f) => f.path === p))
				files.push({
					path: p,
					status: "link",
					additions: null,
					deletions: null,
				});
		// A summary leaves states to each file's patch, which carries its own (#1101 cat 16).
		const states = withPatch
			? await statesAt(
					store,
					to,
					files.filter((f) => f.status !== "link").map((f) => f.path),
				)
			: new Map<string, string>();
		const sum = (k: "additions" | "deletions") =>
			files.reduce((n, f) => n + (f[k] ?? 0), 0);
		const turns = refs.turns;
		return {
			state: "ok",
			repo: repo.name,
			base: repo.head,
			branch: repo.branch,
			files,
			additions: sum("additions"),
			deletions: sum("deletions"),
			patch,
			omitted: !withPatch ? "per-file" : patch === null ? "too-large" : null,
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
				interrupted: refs.interrupted,
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
	opts: { patch?: "none" } = {},
): Promise<WorktreeChanges> {
	const repos: WorktreeRepoChanges[] = [];
	if (!ws || ws.layout === "folder") return { repos };
	for (let i = 0; i < ws.repos.length; i++)
		repos.push(
			await repoScoped(ws, i, scope, turn, ctx, opts.patch !== "none"),
		);
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
		const snap = await withStoreLock(store.gitDir, async () => {
			forgetNow(store);
			return takeSnapshot(store, {
				ref: `${TURN_REF}/${turnId}/${phase}`,
				signal,
			});
		});
		if (phase === "end" && !signal.aborted)
			void warmSummary(store, snap.commit).catch(() => {});
	}
}

const reachedCache = new Set<string>();

/**
 * Only a snapshot, or a commit a ref of ours or the files now reach: never any object the
 * alternates hold. Snapshots are never rewritten, so a commit once reached stays reached.
 */
async function reachable(store: SnapshotStore, commit: string) {
	const key = `${store.gitDir}\0${commit}`;
	if (reachedCache.has(key)) return true;
	// Our own snapshot commits (a past "now" has no ref), or any commit a ref of ours reaches.
	const note = await store
		.git(["log", "-1", "--format=%s", commit])
		.then((o) => o.trim())
		.catch(() => "");
	let ok =
		note === "PrismaLens snapshot" || note.startsWith("PrismaLens revert");
	const tips = (
		await store.git(["for-each-ref", "--format=%(objectname)", "refs/pl"])
	)
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const isAncestor = (tip: string) =>
		store
			.git(["merge-base", "--is-ancestor", commit, tip])
			.then(() => true)
			.catch(() => false);
	for (const tip of ok ? [] : tips) {
		ok = await isAncestor(tip);
		if (ok) break;
	}
	if (!ok) ok = await isAncestor((await nowSnapshot(store)).commit);
	if (ok) reachedCache.add(key);
	return ok;
}

/** One file's patch between two commits a scoped diff named (#1101 category 16 item 7). */
export async function readChangesPatch(
	ws: RunWorkspace | null,
	runId: string,
	q: { repo: string; from: string; to: string; path: string },
	roots?: readonly string[],
): Promise<WorktreePatch> {
	const none = { state: "unavailable", reason: "no-workspace" } as const;
	const i = ws?.repos.findIndex((r) => r.name === q.repo) ?? -1;
	if (!ws || i < 0 || !isSafeRepoPath(q.path)) return none;
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
		if (!(await reachable(store, q.from)) || !(await reachable(store, q.to)))
			return none;
		const patch = (
			await store.git([
				"diff",
				"--full-index",
				...DIFF,
				q.from,
				q.to,
				"--",
				q.path,
			])
		).toString();
		if (Buffer.byteLength(patch) > RUN_DIFF_MAX_BYTES)
			return { state: "unavailable", reason: "too-large" };
		const at = await statesAt(store, q.to, [q.path]);
		return { state: "ok", patch, at: at.get(q.path) ?? "absent" };
	} catch {
		return none;
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
		if (!(await reachable(store, commit)))
			return { state: "unavailable", reason: "no-workspace" };
		// A path the commit lacks fails `cat-file -s`: it is absent, never an empty file.
		const told = (
			await store.git(["cat-file", "-s", `${commit}:${path}`]).catch(() => "")
		).trim();
		const size = /^\d+$/.test(told) ? Number(told) : Number.NaN;
		if (Number.isNaN(size)) return { state: "unavailable", reason: "absent" };
		if (size === 0) return { state: "ok", contents: "" };
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
	// The store's root is a real path (recordedRoot); a location may sit behind a link, as macOS /var does.
	const real = (r: string) => {
		try {
			return realpathSync(resolve(r));
		} catch {
			return resolve(r);
		}
	};
	const inRoot = (d: string) => roots.some((r) => samePath(real(r), d));
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
		const t = input.target;
		// An undo's before and target, or a turn's start and end; an unknown one is refused before a `before` ref is written (#1154).
		let known: [string, string] = ["", ""];
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
			const [b, target] = await Promise.all([ref("before"), ref("target")]);
			if (!b || !target) return refused("no-snapshot");
			known = [b, target];
		} else if (t.kind === "turn") {
			const turn = (await turnSnapshots(store)).find((x) => x.seq === t.seq);
			if (!turn?.start || !turn.end) return refused("no-snapshot");
			known = [turn.start, turn.end];
		}
		const id = String(clock.now());
		const before = await takeSnapshot(store, {
			ref: `${REVERT_REF}/${id}/before`,
		});
		// A = the state each path must still hold; B = the state it is set to.
		let paths: string[];
		let want: Map<string, string>;
		let next: Map<string, string>;
		/** The commits A and B come from: their skipped lists bar those paths too. */
		let sources: string[];
		if (t.kind === "undo" || t.kind === "turn") {
			// An undo sets the revert's target back to its before; a turn undo, its end to its start.
			const [b, a] = known;
			paths = await changedPaths(store, b, a);
			[want, next] = await Promise.all([
				statesAt(store, a, paths),
				statesAt(store, b, paths),
			]);
			sources = t.kind === "undo" ? [b] : [b, a];
		} else {
			const ends = await endsOf(store, input.scope, input.turn, before.commit, {
				head: before.head,
			});
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
		const [now, ...messages] = await Promise.all([
			statesAt(store, before.commit, paths),
			...sources.map((c) => store.git(["log", "-1", "--format=%B", c])),
		]);
		const ends_skipped = messages.flatMap((m) => skippedOf(m.trim()));
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
			const [, patch] = await Promise.all([
				store.git(["read-tree", before.commit], { index: idx.path }),
				t.kind === "hunk"
					? store.git([
							"diff",
							"--full-index",
							...DIFF,
							input.from,
							before.commit,
							"--",
							t.path,
						])
					: "",
			]);
			if (t.kind === "hunk") {
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
				// Mode 0 removes the entry: every path is set by one git process (#1154).
				const info = paths.map((p) => {
					const b = next.get(p) ?? "absent";
					return b === "absent"
						? `0 ${"0".repeat(before.commit.length)}\t${p}`
						: `${b}\t${p}`;
				});
				await store.git(["update-index", "-z", "--index-info"], {
					index: idx.path,
					input: `${info.join("\0")}\0`,
				});
			}
			const tree = (
				await store.git(["write-tree"], { index: idx.path })
			).trim();
			const final = await statesAt(store, tree, paths);
			// The parent is the HEAD the before snapshot read, under this same lock.
			const head = before.head;
			const blobs = [...final.values()]
				.filter((st) => st !== "absent")
				.map((st) => st.split(" ")[1] as string);
			const [target, present] = await Promise.all([
				store
					.git(["commit-tree", tree, "-p", head, "-F", "-"], {
						input: `PrismaLens revert ${id}\n`,
					})
					.then((o) => o.trim()),
				blobs.length
					? store.git(["cat-file", "--batch-check=%(objectname)"], {
							input: `${blobs.join("\n")}\n`,
						})
					: "",
			]);
			// Every blob is checked present before the first write: a pruned object fails here, not halfway.
			if (present.split("\n").some((l) => l.trim().endsWith(" missing")))
				throw new SnapshotUnavailable("commit-gone");
			// The journal is down before the first write: an interrupted revert can be undone.
			await store.git(["update-ref", `${REVERT_REF}/${id}/target`, target]);
			const written = await writeStates(store, {
				base: before.commit,
				targets: final,
				backup: now,
			});
			if (written.linked) return refused("linked", [written.linked]);
			await takeSnapshot(store, { ref: `${REVERT_REF}/${id}/after` });
			return {
				state: "done",
				revertId: id,
				paths: written.receipt.map((r) => r.path),
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

// ---------- Rewind, undo and restore (#1193) ----------

/** The paths each tool call of a turn named: the event's run-branch seq and its paths. */
export interface NamedPaths {
	seq: number;
	paths: string[];
}

export type RewindKeep = { path: string; why: KeepWhy };

export type RewindRepoRefusal = "stale" | "linked" | "no-snapshot" | "gone";

/** One write's journal row: the path, and the `mode blob` (or `absent`) it was set to. */
export interface ReceiptRow {
	path: string;
	wrote: string;
}

const opRef = (op: string, k: string) => `${OP_REF}/${op}/${k}`;

async function refOf(store: SnapshotStore, ref: string): Promise<string> {
	return store
		.git(["rev-parse", "--verify", "-q", ref])
		.then((o) => o.trim())
		.catch(() => "");
}

/** The operation's first ref: what it is, so a boot that finds it half-done can name it. */
async function writeMeta(
	store: SnapshotStore,
	op: string,
	meta: {
		kind: "rewind" | "undo" | "restore";
		rewindId: string | null;
		thread: string;
	},
): Promise<void> {
	const empty = (await store.git(["mktree"], { input: "" })).trim();
	const commit = (
		await store.git(["commit-tree", empty, "-F", "-"], {
			input: JSON.stringify({ ...meta, repo: store.repo.name }),
		})
	).trim();
	await store.git(["update-ref", opRef(op, "meta"), commit]);
}

/** A path's `mode blob` on disk now, through its own attributes (R14); `absent` when gone. */
async function stateOnDisk(store: SnapshotStore, p: string): Promise<string> {
	const st = await lstat(join(store.root, p)).catch(() => null);
	if (!st) return "absent";
	if (!st.isFile()) return "special";
	const blob = (
		await store.git(["hash-object", `--path=${p}`, "--", p], { work: true })
	).trim();
	return `${st.mode & 0o111 ? "100755" : "100644"} ${blob}`;
}

/**
 * Every ancestor of `p` is a plain folder inside the worktree (R17): no link, junction or
 * reparse point, and its real path under the root's. False refuses the whole repo.
 */
async function ancestorsPlain(root: string, p: string): Promise<boolean> {
	const parts = p.split("/");
	let at = root;
	for (const part of parts.slice(0, -1)) {
		at = join(at, part);
		const st = await lstat(at).catch(() => null);
		if (!st) return true;
		if (st.isSymbolicLink() || !st.isDirectory()) return false;
	}
	const [realRoot, realDir] = await Promise.all([
		realpath(root).catch(() => null),
		realpath(dirname(join(root, p))).catch(() => null),
	]);
	if (!realRoot) return false;
	if (!realDir) return true;
	const rel = relative(realRoot, realDir);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Paths whose attributes run a filter, ident or encoding: never written (R18). */
async function filteredPaths(
	store: SnapshotStore,
	paths: readonly string[],
): Promise<Set<string>> {
	const out = new Set<string>();
	for (let i = 0; i < paths.length; i += 200) {
		const batch = paths.slice(i, i + 200);
		const raw = await store
			.git(
				[
					"check-attr",
					"-z",
					"filter",
					"ident",
					"working-tree-encoding",
					"--",
					...batch,
				],
				{ work: true },
			)
			.catch(() => "");
		const f = raw.split("\0");
		for (let j = 0; j + 2 < f.length; j += 3) {
			const value = f[j + 2];
			if (value && value !== "unspecified" && value !== "unset")
				out.add(f[j] as string);
		}
	}
	return out;
}

export interface WriteResult {
	receipt: ReceiptRow[];
	kept: RewindKeep[];
	/** A linked ancestor stopped the writes; what was written was set back. */
	linked: string | null;
}

/**
 * The one writer for revert, rewind, undo and restore: sets each path to its state in
 * `targets` through a scratch index and `checkout-index`, or unlinks it. Each write is
 * checked first: the path's ancestors, then that it still holds its `backup` state.
 * Callers hold the store's lock and have checked every target blob is present.
 */
export async function writeStates(
	store: SnapshotStore,
	o: {
		/** The commit the scratch index starts from: the operation's backup. */
		base: string;
		/** `mode blob` or `absent` per path. */
		targets: Map<string, string>;
		/** Each path's state in the backup: a path that differs now was saved meanwhile. */
		backup: Map<string, string>;
	},
): Promise<WriteResult> {
	const kept: RewindKeep[] = [];
	const receipt: ReceiptRow[] = [];
	const paths = [...o.targets.keys()];
	const filtered = await filteredPaths(store, paths);
	const idx = await scratchIndex();
	try {
		const work = { work: true, index: idx.path } as const;
		await store.git(["read-tree", o.base], { index: idx.path });
		for (const p of paths) {
			const b = o.targets.get(p) ?? "absent";
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
		await sameRoot(store);
		const undo = async () => {
			// A linked ancestor mid-operation: what this call wrote goes back to the backup's states.
			const back = await scratchIndex();
			try {
				await store.git(["read-tree", o.base], { index: back.path });
				for (const r of receipt) {
					const was = o.backup.get(r.path) ?? "absent";
					if (!(await ancestorsPlain(store.root, r.path))) continue;
					if (was === "absent") {
						await unlink(join(store.root, r.path)).catch(() => {});
						continue;
					}
					await store.git(["checkout-index", "-f", "--", r.path], {
						work: true,
						index: back.path,
					});
				}
			} finally {
				await back.done();
			}
		};
		for (const p of paths) {
			if (filtered.has(p)) {
				kept.push({ path: p, why: "filtered" });
				continue;
			}
			if (
				!(await ancestorsPlain(store.root, p)) ||
				(await linkedPath(store.root, p)) ||
				(await collides(store.root, p))
			) {
				await undo();
				return { receipt: [], kept, linked: p };
			}
			if ((await stateOnDisk(store, p)) !== (o.backup.get(p) ?? "absent")) {
				kept.push({ path: p, why: "changed-while-rewinding" });
				continue;
			}
			const target = o.targets.get(p) ?? "absent";
			if (target === "absent") {
				await unlink(join(store.root, p)).catch(() => {});
			} else await store.git(["checkout-index", "-f", "--", p], work);
			receipt.push({ path: p, wrote: target });
		}
		return { receipt, kept, linked: null };
	} finally {
		await idx.done();
	}
}

/** A path, made relative to the repo root when a tool named it absolutely. */
function repoRelative(root: string, raw: string): string | null {
	const slashed = raw.replaceAll("\\", "/");
	if (!isAbsolute(raw) && !/^[A-Za-z]:\//.test(slashed))
		return isSafeRepoPath(slashed.replace(/^\.\//, ""))
			? slashed.replace(/^\.\//, "")
			: null;
	const rel = relative(root, raw).replaceAll("\\", "/");
	return isSafeRepoPath(rel) ? rel : null;
}

interface Classified {
	revert: { path: string; status: "added" | "modified" | "deleted" }[];
	duringTurn: string[];
	kept: RewindKeep[];
	/** Target state per path to write: its state at T. */
	targets: Map<string, string>;
	linkedAncestor: boolean;
}

/** The turn each path's last change came from, and the paths those turns named. */
async function classify(
	store: SnapshotStore,
	T: string,
	now: Snapshot,
	after: TurnSnapshot[],
	named: readonly NamedPaths[],
	include: ReadonlySet<string>,
): Promise<Classified> {
	const paths = await changedPaths(store, T, now.commit);
	const skipped = new Set([
		...now.skipped,
		...skippedOf((await store.git(["log", "-1", "--format=%B", T])).trim()),
	]);
	const turnOf = (seq: number) => after.findLast((t) => t.seq <= seq);
	const namedBy = new Map<number, Set<string>>();
	for (const n of named) {
		const t = turnOf(n.seq);
		if (!t) continue;
		const set = namedBy.get(t.seq) ?? new Set<string>();
		for (const raw of n.paths) {
			const rel = repoRelative(store.root, raw);
			if (rel) set.add(rel);
		}
		namedBy.set(t.seq, set);
	}
	const changedBy = new Map<string, TurnSnapshot[]>();
	const outside = new Set<string>();
	for (const [i, t] of after.entries()) {
		if (t.start && t.end)
			for (const p of await changedPaths(store, t.start, t.end))
				changedBy.set(p, [...(changedBy.get(p) ?? []), t]);
		if (t.end) {
			const next = after.slice(i + 1).find((x) => x.start)?.start ?? now.commit;
			for (const p of await changedPaths(store, t.end, next)) outside.add(p);
		}
	}
	const [atT, atNow] = await Promise.all([
		statesAt(store, T, paths),
		statesAt(store, now.commit, paths),
	]);
	const out: Classified = {
		revert: [],
		duringTurn: [],
		kept: [],
		targets: new Map(),
		linkedAncestor: false,
	};
	for (const p of paths) {
		const turns = changedBy.get(p) ?? [];
		const last = turns.at(-1);
		if (
			skipped.has(p) ||
			(await linkedPath(store.root, p)) ||
			(await collides(store.root, p))
		) {
			out.kept.push({ path: p, why: "linked" });
			continue;
		}
		if (!last) {
			out.kept.push({ path: p, why: "yours" });
			continue;
		}
		const endState = last.end
			? (await statesAt(store, last.end, [p])).get(p)
			: undefined;
		if (outside.has(p) || endState !== atNow.get(p)) {
			out.kept.push({ path: p, why: "both" });
			continue;
		}
		const nameIt = turns.some((t) => namedBy.get(t.seq)?.has(p));
		if (!nameIt && !include.has(p)) {
			out.duringTurn.push(p);
			continue;
		}
		if (!(await ancestorsPlain(store.root, p))) out.linkedAncestor = true;
		const before = atT.get(p) ?? "absent";
		const nowState = atNow.get(p) ?? "absent";
		out.targets.set(p, before);
		out.revert.push({
			path: p,
			status:
				before === "absent"
					? "added"
					: nowState === "absent"
						? "deleted"
						: "modified",
		});
	}
	return out;
}

type Unavailable = Extract<
	RewindRepoPreview,
	{ state: "unavailable" }
>["reason"];

/** The thread's own worktree for one repo, or why it can't be rewound. */
async function rewindStore(
	ws: RunWorkspace,
	i: number,
	ctx: ScopeContext,
): Promise<SnapshotStore | Unavailable> {
	const block = blockOf(ws, ctx);
	if (block) return block;
	const repo = ws.repos[i] as RunWorkspace["repos"][number];
	let store: SnapshotStore;
	try {
		store = await openStore(ctx.runId, i, repo, rootsOf(ws, ctx));
	} catch (e) {
		return e instanceof SnapshotUnavailable && e.reason === "removed"
			? "removed"
			: "no-snapshot";
	}
	if (!ownedBy(store.root, ctx.runId, rootsOf(ws, ctx))) return "borrowed";
	return store;
}

/** The first turn snapshot after the message: the state its files go back to. */
async function cutOf(
	store: SnapshotStore,
	fromSeq: number,
): Promise<{ T: string; after: TurnSnapshot[] } | null> {
	const turns = await turnSnapshots(store);
	const after = turns.filter((t) => t.seq > fromSeq);
	const T = after.find((t) => t.start)?.start;
	return T ? { T, after } : null;
}

async function tokenOf(
	store: SnapshotStore,
	snap: string,
): Promise<{ head: string; tree: string }> {
	return {
		head: (await store.git(["rev-parse", `${snap}^`])).trim(),
		tree: (await store.git(["rev-parse", `${snap}^{tree}`])).trim(),
	};
}

/** What a rewind to `fromSeq` would do in each repo; nothing is written. */
export async function previewRewindFiles(
	ws: RunWorkspace | null,
	fromSeq: number,
	named: readonly NamedPaths[],
	ctx: ScopeContext,
): Promise<RewindRepoPreview[]> {
	if (!ws) return [];
	const out: RewindRepoPreview[] = [];
	for (let i = 0; i < ws.repos.length; i++) {
		const name = (ws.repos[i] as RunWorkspace["repos"][number]).name;
		const store = await rewindStore(ws, i, ctx);
		if (typeof store === "string") {
			out.push({ repo: name, state: "unavailable", reason: store });
			continue;
		}
		try {
			const cut = await cutOf(store, fromSeq);
			if (!cut) {
				out.push({ repo: name, state: "unavailable", reason: "no-snapshot" });
				continue;
			}
			const now = await nowSnapshot(store);
			const c = await classify(store, cut.T, now, cut.after, named, new Set());
			if (c.linkedAncestor) {
				out.push({ repo: name, state: "unavailable", reason: "linked" });
				continue;
			}
			const token = await tokenOf(store, now.commit);
			out.push({
				repo: name,
				state: "ok",
				...token,
				revert: c.revert.slice(0, REWIND_PATHS_MAX),
				duringTurn: c.duringTurn.slice(0, REWIND_PATHS_MAX),
				kept: c.kept.slice(0, REWIND_PATHS_MAX),
				commits: await commitsSince(store, cut.T, token.head),
			});
		} catch (e) {
			out.push({
				repo: name,
				state: "unavailable",
				reason:
					e instanceof SnapshotUnavailable && e.reason === "removed"
						? "removed"
						: "no-snapshot",
			});
		}
	}
	return out;
}

async function commitsSince(
	store: SnapshotStore,
	T: string,
	head: string,
): Promise<number> {
	const n = await store
		.git(["rev-list", "--count", `${T}^..${head}`])
		.then((o) => Number(o.trim()))
		.catch(() => 0);
	return Number.isFinite(n) ? n : 0;
}

export type RepoOpResult =
	| {
			state: "done";
			repo: string;
			op: string;
			reverted: string[];
			kept: RewindKeep[];
	  }
	| {
			state: "refused";
			repo: string;
			reason: RewindRepoRefusal;
			paths: string[];
	  };

/** Commits every target blob is present: a pruned object fails here, before any write. */
async function blobsPresent(
	store: SnapshotStore,
	targets: Map<string, string>,
): Promise<void> {
	for (const st of targets.values())
		if (st !== "absent")
			await store
				.git(["cat-file", "-e", st.split(" ")[1] as string])
				.catch(() => {
					throw new SnapshotUnavailable("commit-gone");
				});
}

/** The tree of `base` with each path at its target state, as a commit on HEAD. */
async function targetCommit(
	store: SnapshotStore,
	base: string,
	targets: Map<string, string>,
	note: string,
): Promise<string> {
	const idx = await scratchIndex();
	try {
		await store.git(["read-tree", base], { index: idx.path });
		for (const [p, b] of targets) {
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
		const tree = (await store.git(["write-tree"], { index: idx.path })).trim();
		const head = await worktreeHead(store);
		return (
			await store.git(["commit-tree", tree, "-p", head, "-F", "-"], {
				input: `${note}\n`,
			})
		).trim();
	} finally {
		await idx.done();
	}
}

async function finish(
	store: SnapshotStore,
	op: string,
	written: WriteResult,
): Promise<void> {
	const blob = (
		await store.git(["hash-object", "-w", "--stdin"], {
			input: JSON.stringify(written.receipt),
		})
	).trim();
	await store.git(["update-ref", opRef(op, "receipt"), blob]);
	forgetNow(store);
	await takeSnapshot(store, { ref: opRef(op, "after") });
}

/** The receipt an operation wrote: the paths it set and to what (R19). */
async function receiptOf(
	store: SnapshotStore,
	op: string,
): Promise<ReceiptRow[]> {
	const blob = await refOf(store, opRef(op, "receipt"));
	if (!blob) return [];
	try {
		const rows = JSON.parse(
			await store.git(["cat-file", "blob", blob]),
		) as unknown;
		return Array.isArray(rows)
			? rows.filter(
					(r): r is ReceiptRow =>
						typeof r?.path === "string" && typeof r?.wrote === "string",
				)
			: [];
	} catch {
		return [];
	}
}

/**
 * Sets the agent's files in one repo back to the message (#1193): a full backup first,
 * then the target, then each write checked as it lands. The caller writes `committed`
 * once its DB transaction holds the operation's event.
 */
export async function rewindFiles(
	ws: RunWorkspace,
	repoName: string,
	ctx: ScopeContext,
	o: {
		op: string;
		rewindId: string;
		fromSeq: number;
		named: readonly NamedPaths[];
		include: ReadonlySet<string>;
		expect: { head: string; tree: string };
	},
): Promise<RepoOpResult> {
	const i = ws.repos.findIndex((r) => r.name === repoName);
	const store = i < 0 ? "removed" : await rewindStore(ws, i, ctx);
	if (typeof store === "string")
		return { state: "refused", repo: repoName, reason: "gone", paths: [] };
	return withStoreLock(store.gitDir, async () => {
		const cut = await cutOf(store, o.fromSeq);
		if (!cut)
			return {
				state: "refused",
				repo: repoName,
				reason: "no-snapshot",
				paths: [],
			};
		await writeMeta(store, o.op, {
			kind: "rewind",
			rewindId: o.rewindId,
			thread: ctx.runId,
		});
		forgetNow(store);
		const backup = await takeSnapshot(store, { ref: opRef(o.op, "backup") });
		const token = await tokenOf(store, backup.commit);
		if (token.head !== o.expect.head || token.tree !== o.expect.tree)
			return { state: "refused", repo: repoName, reason: "stale", paths: [] };
		const c = await classify(
			store,
			cut.T,
			backup,
			cut.after,
			o.named,
			o.include,
		);
		if (c.linkedAncestor)
			return { state: "refused", repo: repoName, reason: "linked", paths: [] };
		await blobsPresent(store, c.targets);
		const target = await targetCommit(
			store,
			backup.commit,
			c.targets,
			`PrismaLens rewind ${o.rewindId}`,
		);
		await store.git(["update-ref", opRef(o.op, "target"), target]);
		const states = await statesAt(store, backup.commit, [...c.targets.keys()]);
		const written = await writeStates(store, {
			base: backup.commit,
			targets: c.targets,
			backup: states,
		});
		if (written.linked)
			return {
				state: "refused",
				repo: repoName,
				reason: "linked",
				paths: [written.linked],
			};
		await finish(store, o.op, written);
		return {
			state: "done",
			repo: repoName,
			op: o.op,
			reverted: written.receipt.map((r) => r.path),
			kept: [
				...c.kept,
				...c.duringTurn.map((p) => ({ path: p, why: "during-turn" as const })),
				...written.kept,
			],
		};
	});
}

/**
 * Puts back what a rewind's operation `of` wrote, and what later turns changed (R5): each
 * path goes to its state in that rewind's backup, only where it still holds what the
 * rewind or the last later turn left. Its own operation, with its own backup.
 */
export async function undoRewindFiles(
	ws: RunWorkspace,
	repoName: string,
	ctx: ScopeContext,
	o: { op: string; of: string; rewindId: string; afterSeq: number },
): Promise<RepoOpResult> {
	const i = ws.repos.findIndex((r) => r.name === repoName);
	const store = i < 0 ? "removed" : await rewindStore(ws, i, ctx);
	if (typeof store === "string")
		return { state: "refused", repo: repoName, reason: "gone", paths: [] };
	return withStoreLock(store.gitDir, async () => {
		const was = await refOf(store, opRef(o.of, "backup"));
		if (!was)
			return {
				state: "refused",
				repo: repoName,
				reason: "no-snapshot",
				paths: [],
			};
		const receipt = await receiptOf(store, o.of);
		const later = (await turnSnapshots(store)).filter(
			(t) => t.seq > o.afterSeq && t.start && t.end,
		);
		const expected = new Map(receipt.map((r) => [r.path, r.wrote]));
		const byTurn = new Set<string>();
		for (const t of later)
			for (const p of await changedPaths(
				store,
				t.start as string,
				t.end as string,
			)) {
				byTurn.add(p);
				expected.set(
					p,
					(await statesAt(store, t.end as string, [p])).get(p) ?? "absent",
				);
			}
		await writeMeta(store, o.op, {
			kind: "undo",
			rewindId: o.rewindId,
			thread: ctx.runId,
		});
		forgetNow(store);
		const backup = await takeSnapshot(store, { ref: opRef(o.op, "backup") });
		const paths = [...expected.keys()];
		const [desired, now] = await Promise.all([
			statesAt(store, was, paths),
			statesAt(store, backup.commit, paths),
		]);
		const targets = new Map<string, string>();
		const kept: RewindKeep[] = [];
		const skipped = new Set(backup.skipped);
		for (const p of paths) {
			if (skipped.has(p)) {
				kept.push({ path: p, why: "linked" });
				continue;
			}
			if (now.get(p) !== expected.get(p)) {
				kept.push({ path: p, why: byTurn.has(p) ? "both" : "yours" });
				continue;
			}
			if (now.get(p) !== desired.get(p))
				targets.set(p, desired.get(p) ?? "absent");
		}
		await blobsPresent(store, targets);
		const target = await targetCommit(
			store,
			backup.commit,
			targets,
			`PrismaLens undo ${o.rewindId}`,
		);
		await store.git(["update-ref", opRef(o.op, "target"), target]);
		const written = await writeStates(store, {
			base: backup.commit,
			targets,
			backup: now,
		});
		if (written.linked)
			return {
				state: "refused",
				repo: repoName,
				reason: "linked",
				paths: [written.linked],
			};
		await finish(store, o.op, written);
		return {
			state: "done",
			repo: repoName,
			op: o.op,
			reverted: written.receipt.map((r) => r.path),
			kept: [...kept, ...written.kept],
		};
	});
}

/** An interrupted operation's restore, worked out fresh from its refs and the files now (R16). */
export interface RestorePlan {
	head: string;
	tree: string;
	backup: string;
	now: string;
	overwrite: string[];
	created: string[];
	damaged: string[];
}

async function restorePlan(
	store: SnapshotStore,
	of: string,
	now: Snapshot,
): Promise<RestorePlan | null> {
	const [backup, target] = await Promise.all([
		refOf(store, opRef(of, "backup")),
		refOf(store, opRef(of, "target")),
	]);
	if (!backup) return null;
	const touched = target
		? new Set(await changedPaths(store, backup, target))
		: new Set<string>();
	const written = (await changedPaths(store, backup, now.commit)).filter((p) =>
		touched.has(p),
	);
	const [atBackup, atTarget, atNow] = await Promise.all([
		statesAt(store, backup, written),
		target ? statesAt(store, target, written) : Promise.resolve(new Map()),
		statesAt(store, now.commit, written),
	]);
	const plan: RestorePlan = {
		...(await tokenOf(store, now.commit)),
		backup,
		now: now.commit,
		overwrite: [],
		created: [],
		damaged: [],
	};
	for (const p of written) {
		if (atNow.get(p) === atBackup.get(p)) continue;
		if (atBackup.get(p) === "absent") plan.created.push(p);
		else if (atNow.get(p) === atTarget.get(p)) plan.overwrite.push(p);
		else plan.damaged.push(p);
	}
	return plan;
}

/**
 * The paths an interrupted operation may have written: changed between its backup and
 * `now` (a snapshot, never a worktree write), and in its target. Read from the store alone.
 */
export async function interruptedWritten(
	gitDir: string,
	of: string,
	now: string | null,
): Promise<string[]> {
	const [backup, target] = await Promise.all(
		["backup", "target"].map((k) =>
			storeGit(gitDir, ["rev-parse", "--verify", "-q", opRef(of, k)])
				.then((o) => o.trim())
				.catch(() => ""),
		),
	);
	if (!backup || !target) return [];
	const diff = async (a: string, b: string) =>
		(
			await storeGit(gitDir, [
				"diff-tree",
				"-r",
				"--no-renames",
				"--name-only",
				"-z",
				a,
				b,
			]).catch(() => "")
		)
			.split("\0")
			.filter(isSafeRepoPath);
	const inTarget = new Set(await diff(backup, target));
	return now
		? (await diff(backup, now)).filter((p) => inTarget.has(p))
		: [...inTarget];
}

/** A snapshot of one repo's files now, for boot's look at an interrupted operation. */
export async function snapshotNow(
	ws: RunWorkspace,
	repoName: string,
	ctx: ScopeContext,
): Promise<string | null> {
	const i = ws.repos.findIndex((r) => r.name === repoName);
	if (i < 0) return null;
	try {
		const store = await openStore(
			ctx.runId,
			i,
			ws.repos[i] as RunWorkspace["repos"][number],
			rootsOf(ws, ctx),
		);
		return (await nowSnapshot(store)).commit;
	} catch {
		return null;
	}
}

/** What Restore of operation `of` would write in one repo, from a fresh look at the files. */
export async function previewRestoreFiles(
	ws: RunWorkspace,
	repoName: string,
	ctx: ScopeContext,
	of: string,
): Promise<RestorePlan | "gone" | RevertBlock> {
	const i = ws.repos.findIndex((r) => r.name === repoName);
	const store = i < 0 ? "removed" : await rewindStore(ws, i, ctx);
	if (store === "running" || store === "view-only") return store;
	if (typeof store === "string") return "gone";
	return withStoreLock(store.gitDir, async () => {
		forgetNow(store);
		const now = await takeSnapshot(store);
		return (await restorePlan(store, of, now)) ?? "gone";
	});
}

/**
 * Restores an interrupted operation's backup (#1193 R16): paths still at its target go
 * back, and created or damaged paths only when ticked. A normal operation with its own backup.
 */
export async function restoreFiles(
	ws: RunWorkspace,
	repoName: string,
	ctx: ScopeContext,
	o: {
		op: string;
		of: string;
		expect: { head: string; tree: string };
		include: ReadonlySet<string>;
	},
): Promise<RepoOpResult> {
	const i = ws.repos.findIndex((r) => r.name === repoName);
	const store = i < 0 ? "removed" : await rewindStore(ws, i, ctx);
	if (typeof store === "string")
		return { state: "refused", repo: repoName, reason: "gone", paths: [] };
	return withStoreLock(store.gitDir, async () => {
		await writeMeta(store, o.op, {
			kind: "restore",
			rewindId: null,
			thread: ctx.runId,
		});
		forgetNow(store);
		const backup = await takeSnapshot(store, { ref: opRef(o.op, "backup") });
		const plan = await restorePlan(store, o.of, backup);
		if (!plan)
			return { state: "refused", repo: repoName, reason: "gone", paths: [] };
		if (plan.head !== o.expect.head || plan.tree !== o.expect.tree)
			return { state: "refused", repo: repoName, reason: "stale", paths: [] };
		const pick = [
			...plan.overwrite,
			...plan.created.filter((p) => o.include.has(p)),
			...plan.damaged.filter((p) => o.include.has(p)),
		];
		const targets = await statesAt(store, plan.backup, pick);
		const now = await statesAt(store, backup.commit, pick);
		await blobsPresent(store, targets);
		const target = await targetCommit(
			store,
			backup.commit,
			targets,
			`PrismaLens restore ${o.of}`,
		);
		await store.git(["update-ref", opRef(o.op, "target"), target]);
		const written = await writeStates(store, {
			base: backup.commit,
			targets,
			backup: now,
		});
		if (written.linked)
			return {
				state: "refused",
				repo: repoName,
				reason: "linked",
				paths: [written.linked],
			};
		await finish(store, o.op, written);
		return {
			state: "done",
			repo: repoName,
			op: o.op,
			reverted: written.receipt.map((r) => r.path),
			kept: [
				...plan.created
					.filter((p) => !o.include.has(p))
					.map((p) => ({ path: p, why: "yours" as const })),
				...plan.damaged
					.filter((p) => !o.include.has(p))
					.map((p) => ({ path: p, why: "damaged" as const })),
				...written.kept,
			],
		};
	});
}

/**
 * Settles an operation in one repo's store: `committed` once its event is in the DB,
 * `dropped` when it was refused or compensated and never reached the DB.
 */
export async function markOp(
	ws: RunWorkspace,
	repoName: string,
	ctx: ScopeContext,
	op: string,
	k: "committed" | "dropped",
): Promise<void> {
	const i = ws.repos.findIndex((r) => r.name === repoName);
	if (i < 0) return;
	const store = await openStore(
		ctx.runId,
		i,
		ws.repos[i] as RunWorkspace["repos"][number],
		rootsOf(ws, ctx),
	).catch(() => null);
	if (!store) return;
	await withStoreLock(store.gitDir, async () => {
		const after = await refOf(store, opRef(op, "after"));
		const meta = await refOf(store, opRef(op, "meta"));
		await store.git(["update-ref", opRef(op, k), after || meta]);
	});
}

/** Marks an operation in a store by its dir alone: boot's `interrupted` or `committed`. */
export async function markStoreOp(
	gitDir: string,
	op: string,
	k: "committed" | "interrupted",
): Promise<void> {
	const at = await storeGit(gitDir, [
		"rev-parse",
		"--verify",
		"-q",
		opRef(op, "meta"),
	]).then((o) => o.trim());
	await storeGit(gitDir, ["update-ref", opRef(op, k), at]);
}

/** Each operation in a store and the refs it has, read without a worktree. */
export async function storeOps(
	gitDir: string,
): Promise<
	Map<string, { refs: Set<string>; meta: Record<string, unknown> | null }>
> {
	const out = new Map<
		string,
		{ refs: Set<string>; meta: Record<string, unknown> | null }
	>();
	const listed = await storeGit(gitDir, [
		"for-each-ref",
		"--format=%(refname)",
		OP_REF,
	]).catch(() => "");
	for (const line of listed.split("\n")) {
		const m = /^refs\/pl\/op\/([0-9a-f-]{36})\/(\w+)$/.exec(line.trim());
		if (!m) continue;
		const op = m[1] as string;
		const got = out.get(op) ?? { refs: new Set<string>(), meta: null };
		got.refs.add(m[2] as string);
		out.set(op, got);
	}
	for (const [op, got] of out) {
		if (!got.refs.has("meta")) continue;
		const message = await storeGit(gitDir, [
			"log",
			"-1",
			"--format=%B",
			opRef(op, "meta"),
		]).catch(() => "");
		try {
			got.meta = JSON.parse(message.trim()) as Record<string, unknown>;
		} catch {
			got.meta = null;
		}
	}
	return out;
}
