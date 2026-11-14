// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	DiffScope,
	RunWorkspace,
	WorktreeRepoChanges,
} from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Columns2, Rows2, WrapText } from "lucide-react";
import { type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { Picker, type PickerOption } from "@/components/kit/Picker";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { copyText } from "@/lib/clipboard";
import {
	FILE_GROUP_IDS,
	type FileGroup,
	fileGroupOf,
	foldsBehindLoad,
} from "@/lib/file-groups";
import { markFirstContent } from "@/lib/first-paint";
import { lazyPart } from "@/lib/lazy";
import { splitPatch } from "@/lib/run-panel";
import { noiseLine, reviewTurn } from "@/lib/turn-review";
import { cn } from "@/lib/utils";
import { sendReference } from "../composer/quote";
import type { PanelSearch } from "../panel/panel-model";
import { type DiffTreeProps, DiffTreeStandIn } from "./DiffTreeStandIn";
import type { DiffFileCtx } from "./diff.actions";
import { FileGroupBar, groupCounts } from "./FileGroups";
import type { PatchHunk } from "./patch-lines";
import { TurnUndo } from "./TurnUndo";
import { filePatchOptions, useScopedChanges } from "./use-scoped-changes";

// The patch viewer and its highlighter load after the tree paints (#1101 category 16 item 7).
const FileDiffPane = lazyPart(
	() => import("./FileDiffPane").then((m) => m.FileDiffPane),
	<Loading />,
);
const FileView = lazyPart(
	() => import("./FileView").then((m) => m.FileView),
	<Loading />,
);
// The tree's library loads after first content; its first rows draw as plain markup meanwhile.
const DiffTree = lazyPart<DiffTreeProps>(
	() => import("./DiffTree").then((m) => m.DiffTree),
	(p) => <DiffTreeStandIn {...p} />,
	{ afterFirstContent: true },
);

export const SCOPE_WORDS: Record<DiffScope, { label: string; detail: string }> =
	{
		all: {
			label: "All vs base",
			detail: "Every change since the thread's base",
		},
		turn: { label: "This turn", detail: "What one agent turn changed" },
		uncommitted: {
			label: "Uncommitted",
			detail: "Changes since the last commit",
		},
		outside: {
			label: "Outside turns",
			detail: "Changed between or after the agent's turns",
		},
	};
const SCOPES = ["all", "turn", "uncommitted", "outside"] as const;

type TurnRef = { seq: number; ended?: boolean };

/**
 * The scope is one picker in the summary line (#1101 category 16): the latest turn reads
 * "This turn", earlier ones sit under Earlier turns as `turn:<seq>`.
 */
export function scopeOptions(turns: readonly TurnRef[]): PickerOption[] {
	const earlier = turns.slice(0, -1);
	return [
		...SCOPES.map((s) => ({
			id: s,
			name: SCOPE_WORDS[s].label,
			description: SCOPE_WORDS[s].detail,
			testId: `diff-scope-${s}`,
		})),
		...earlier.map((t, i) => ({
			id: `turn:${t.seq}`,
			name: `Turn ${i + 1}`,
			group: "Earlier turns",
			testId: `diff-scope-turn-${t.seq}`,
		})),
	];
}

export function scopeValue(
	scope: DiffScope,
	turn: number | null | undefined,
	turns: readonly TurnRef[],
): string {
	if (scope !== "turn") return scope;
	const latest = turns.at(-1)?.seq;
	return turn == null || turn === latest ? "turn" : `turn:${turn}`;
}

export function scopeSearch(id: string): PanelSearch {
	if (id.startsWith("turn:"))
		return { scope: "turn", turn: Number(id.slice(5)) };
	return { scope: id as DiffScope };
}
export type ViewStyle = "auto" | "split" | "unified";

/** The view's toggles; with neither style pressed the diff goes split when there is room. */
const VIEW_TOGGLES = [
	{ id: "unified", label: "Unified", icon: Rows2 },
	{ id: "split", label: "Side by side", icon: Columns2 },
	{ id: "wrap", label: "Wrap lines", icon: WrapText },
] as const;

const bulkOf = (files: readonly { add: number; del: number }[]) => ({
	add: files.reduce((n, f) => n + f.add, 0),
	del: files.reduce((n, f) => n + f.del, 0),
});
const PREFS_KEY = "pl.diff.prefs";

interface Prefs {
	style: ViewStyle;
	wrap: boolean;
	/** File kinds left out of the tree. */
	hidden: FileGroup[];
}

function readPrefs(): Prefs {
	try {
		const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
			style?: unknown;
			wrap?: unknown;
			hidden?: unknown;
		};
		return {
			style: v.style === "split" || v.style === "unified" ? v.style : "auto",
			wrap: v.wrap !== false,
			hidden: Array.isArray(v.hidden)
				? FILE_GROUP_IDS.filter((g) => (v.hidden as unknown[]).includes(g))
				: [],
		};
	} catch {
		return { style: "auto", wrap: true, hidden: [] };
	}
}

/**
 * The library words a gap "N unmodified lines" or, when it cannot count, a hedged
 * sentence; both read as the one control they are (#1101 category 16).
 */
export const SEPARATOR_CSS =
	'[data-unmodified-lines]{font-size:0}[data-unmodified-lines]::after{content:"Show more lines";font-size:var(--diffs-font-size,13px)}';

/** Split needs room for two columns of code; narrower goes unified by itself (#1101 category 16). */
export const SPLIT_MIN_PX = 720;

export type Note =
	| { kind: "draft" }
	| { kind: "added"; text: string }
	| { kind: "hunk"; hunk: PatchHunk };

/**
 * The thread's one diff surface (#1101 category 16): a scope, a file tree with a filter and
 * +/−, split or unified diffs with wrap and expandable context, line comments that go to the
 * composer as chips, and revert by file or hunk, each confirmed and undoable.
 */
export function DiffSurface({
	runId,
	threadId,
	live,
	workspace,
	search,
	onSearch,
}: {
	runId: string;
	threadId: string;
	live: boolean;
	workspace: RunWorkspace;
	search: PanelSearch;
	onSearch: (next: PanelSearch) => void;
}) {
	const scope: DiffScope = search.scope ?? "all";
	const query = useScopedChanges(runId, scope, search.turn, live);
	// With no tree to draw (nothing changed, or the read failed), the answer is the content.
	const settled = !query.isLoading;
	useEffect(() => {
		if (
			settled &&
			!query.data?.repos.some((r) => r.state === "ok" && r.files.length)
		)
			markFirstContent();
	}, [settled, query.data]);
	const [repoAt, setRepoAt] = useState(0);
	const [prefs, setPrefsState] = useState(readPrefs);
	const setPrefs = (next: Partial<typeof prefs>) =>
		setPrefsState((p) => {
			const out = { ...p, ...next };
			try {
				localStorage.setItem(PREFS_KEY, JSON.stringify(out));
			} catch {}
			return out;
		});
	const repos = query.data?.repos ?? [];
	const fromPath = search.path?.split(":")[0];
	const wanted = repos.findIndex((r) => r.repo === fromPath);
	const repo = repos[wanted >= 0 ? wanted : repoAt] ?? repos[0];
	const ok = repo?.state === "ok" ? repo : null;
	const scoped = ok?.scoped;
	const turns = scoped?.turns ?? [];
	const [scopeOpen, setScopeOpen] = useState(false);
	const scoping = scopeValue(scope, scoped?.turn, turns) !== "all";
	// Bulk (lockfiles, snapshots, generated) is counted apart, out of the reviewed total (#1110).
	const review = ok
		? reviewTurn(
				ok.files.map((f) => ({
					path: f.path,
					add: f.additions ?? 0,
					del: f.deletions ?? 0,
					status: f.status,
				})),
			)
		: null;
	const noise = review ? noiseLine(review.noise) : null;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: C opens the scope from anywhere in the pane; the picker is the keyboard path.
		<div
			className="flex min-h-0 flex-1 flex-col @container"
			data-testid="diff-surface"
			data-scope={scope}
			onKeyDown={(e) => {
				const t = e.target as HTMLElement;
				if (
					e.key.toLowerCase() !== "c" ||
					e.ctrlKey ||
					e.metaKey ||
					e.altKey ||
					t.closest("input, textarea, [contenteditable=true]")
				)
					return;
				e.preventDefault();
				e.stopPropagation();
				setScopeOpen(true);
			}}
		>
			<div className="flex shrink-0 items-center gap-1.5 px-2 pt-1.5 pb-1">
				{repos.length > 1 && (
					<Picker
						label="Repository"
						side="bottom"
						value={repo?.repo ?? ""}
						onChange={(r) => setRepoAt(repos.findIndex((x) => x.repo === r))}
						options={repos.map((r) => ({ id: r.repo, name: r.repo }))}
					/>
				)}
				<span className="relative inline-flex shrink-0">
					<Picker
						label="Compare"
						side="bottom"
						testId="diff-scope"
						open={scopeOpen}
						onOpenChange={setScopeOpen}
						value={scopeValue(scope, scoped?.turn, turns)}
						onChange={(id) => onSearch(scopeSearch(id))}
						options={scopeOptions(turns)}
					/>
					{scoping && (
						<span
							aria-hidden
							className="pointer-events-none absolute top-1 right-0.5 size-1.5 rounded-full bg-accent"
							data-testid="diff-scope-dot"
						/>
					)}
				</span>
				<p
					className="m-0 min-w-0 flex-1 truncate text-meta text-text-2 tabular-nums"
					data-testid="diff-scope-named"
				>
					{ok && review && (
						<>
							{"· "}
							{ok.files.length} {ok.files.length === 1 ? "file" : "files"}{" "}
							<span className="text-ok" data-testid="diff-total-add">
								+{ok.additions}
							</span>{" "}
							<span className="text-danger" data-testid="diff-total-del">
								−{ok.deletions}
							</span>
							{noise && (
								<Hint
									label={`Bulk, not read line by line: +${bulkOf(review.noise).add} −${bulkOf(review.noise).del}`}
								>
									<span className="text-text-3"> · {noise}</span>
								</Hint>
							)}
							{scoped?.live ? " · working" : ""}
						</>
					)}
				</p>
				{scoping && (
					<button
						type="button"
						onClick={() => onSearch({ scope: "all" })}
						className="h-7 shrink-0 rounded-control px-1.5 text-meta text-text-2 outline-none hover:text-text-1 focus-visible:ring-1 focus-visible:ring-accent"
						data-testid="diff-scope-clear"
					>
						Clear
					</button>
				)}
				{scope === "turn" &&
					scoped?.turn !== null &&
					scoped?.turn !== undefined && (
						<TurnUndo runId={runId} turnId={scoped.turn} repo={ok?.repo} />
					)}
				<fieldset
					className="m-0 flex shrink-0 items-center border-0 p-0"
					aria-label="Diff view"
					data-testid="diff-view"
				>
					{VIEW_TOGGLES.map((v) => {
						const on = v.id === "wrap" ? prefs.wrap : prefs.style === v.id;
						return (
							<Hint key={v.id} label={v.label}>
								<button
									type="button"
									aria-label={v.label}
									aria-pressed={on}
									onClick={() =>
										v.id === "wrap"
											? setPrefs({ wrap: !prefs.wrap })
											: setPrefs({ style: on ? "auto" : v.id })
									}
									className={cn(
										"grid size-7 shrink-0 place-items-center rounded-control outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:outline focus-visible:outline-accent",
										on ? "bg-surface-3 text-text-1" : "text-text-3",
									)}
									data-testid={`diff-style-${v.id}`}
								>
									<v.icon aria-hidden className="size-3.5" />
								</button>
							</Hint>
						);
					})}
				</fieldset>
			</div>
			{search.view === "file" && search.path?.includes(":") ? (
				<FileView
					runId={runId}
					threadId={threadId}
					workspace={workspace}
					repo={search.path.split(":")[0] as string}
					path={search.path.slice(search.path.indexOf(":") + 1)}
					line={search.line ?? null}
					live={live}
					onBack={() => onSearch({ ...search, view: undefined })}
					backLabel="Changes"
				/>
			) : query.isLoading ? (
				<div className="px-3 pt-3">
					<Loading rows={4} />
				</div>
			) : query.error || !query.data ? (
				<Problem
					className="px-3"
					text="Changes did not load"
					onRetry={() => void query.refetch()}
				/>
			) : !repo ? (
				<Empty className="px-3" text="No code here" testId="diff-none" />
			) : repo.state === "unavailable" ? (
				<Empty
					className="px-3"
					text={
						repo.reason === "no-snapshot"
							? scope === "outside"
								? "No turn has ended yet"
								: "No snapshot for this turn"
							: repo.reason === "removed"
								? "Workspace removed"
								: "Workspace not available"
					}
					testId="diff-unavailable"
				/>
			) : (
				<RepoDiff
					key={`${repo.repo}:${scope}:${scoped?.turn ?? ""}`}
					runId={runId}
					threadId={threadId}
					workspace={workspace}
					repo={repo}
					scope={scope}
					style={prefs.style}
					wrap={prefs.wrap}
					hidden={prefs.hidden}
					onToggleGroup={(g) =>
						setPrefs({
							hidden: prefs.hidden.includes(g)
								? prefs.hidden.filter((x) => x !== g)
								: [...prefs.hidden, g],
						})
					}
					search={search}
					onSearch={onSearch}
				/>
			)}
		</div>
	);
}

/** The PR view's Files tab: the same surface against the base, its picks kept in the tab. */
export function PrFiles(props: {
	runId: string;
	threadId: string;
	live: boolean;
	workspace: RunWorkspace;
}) {
	const [search, setSearch] = useState<PanelSearch>({ scope: "all" });
	return <DiffSurface {...props} search={search} onSearch={setSearch} />;
}

export type OkRepo = Extract<WorktreeRepoChanges, { state: "ok" }>;

type Toast = ReturnType<typeof useToast>["toast"];

/** Opens a workspace path in the host's editor; off the host it says to copy the path. */
export function openInEditor(
	toast: Toast,
	runId: string,
	path: string,
	at?: number,
) {
	void orpc.runWorkspaces.openInEditor
		.call({ id: runId, path, ...(at ? { line: at } : {}) })
		.then((r) =>
			r.opened
				? null
				: toast({
						title: "No editor opened",
						description: "Set one under Settings, General.",
					}),
		)
		.catch(() =>
			toast({
				title: "Opens only on the host",
				description: "Copy the path to open it where you work.",
			}),
		);
}

export function diffLineAt(
	e: SyntheticEvent,
): { side: "additions" | "deletions"; n: number } | null {
	for (const el of e.nativeEvent.composedPath()) {
		if (!(el instanceof HTMLElement) || !el.dataset.line) continue;
		const n = Number(el.dataset.line);
		if (!Number.isFinite(n)) return null;
		return {
			side:
				el.dataset.lineType === "change-deletion" ? "deletions" : "additions",
			n,
		};
	}
	return null;
}

function RepoDiff({
	runId,
	threadId,
	workspace,
	repo,
	scope,
	style,
	wrap,
	hidden,
	onToggleGroup,
	search,
	onSearch,
}: {
	runId: string;
	threadId: string;
	workspace: RunWorkspace;
	repo: OkRepo;
	scope: DiffScope;
	style: ViewStyle;
	wrap: boolean;
	hidden: readonly FileGroup[];
	onToggleGroup: (group: FileGroup) => void;
	search: PanelSearch;
	onSearch: (next: PanelSearch) => void;
}) {
	const scoped = repo.scoped;
	const { toast } = useToast();
	const client = useQueryClient();
	const patches = useMemo(
		() => (repo.patch ? splitPatch(repo.patch) : []),
		[repo.patch],
	);
	const counts = useMemo(() => groupCounts(repo.files), [repo.files]);
	const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
	const visible = useMemo(
		() => repo.files.filter((f) => !hiddenSet.has(fileGroupOf(f.path))),
		[repo.files, hiddenSet],
	);
	const prefix = `${repo.repo}:`;
	const asked = search.path?.startsWith(prefix)
		? search.path.slice(prefix.length)
		: null;
	// The tab opens on a file worth reading: shown in the tree and not folded behind Load.
	const readable = visible.filter((f) => !foldsBehindLoad(f));
	const shown =
		asked && repo.files.some((f) => f.path === asked)
			? asked
			: pickShownFile(readable.length ? readable : repo.files, null);
	const outside = new Set(scoped?.outside ?? []);
	const perFile = repo.omitted === "per-file" && !!scoped;
	// The next two files' patches ride behind the open one, so stepping down the tree is instant.
	useEffect(() => {
		if (!perFile || !scoped || !shown) return;
		const at = visible.findIndex((f) => f.path === shown);
		for (const f of visible.slice(at + 1, at + 3))
			if (
				f.status !== "link" &&
				f.status !== "submodule" &&
				!foldsBehindLoad(f)
			)
				void client.prefetchQuery(
					filePatchOptions(runId, repo.repo, scoped, f.path),
				);
	}, [perFile, scoped, shown, visible, client, runId, repo.repo]);
	if (repo.files.length === 0)
		return (
			<Empty className="px-3" text="No changes here" testId="diff-empty" />
		);
	const file = repo.files.find((f) => f.path === shown);
	const patch = patches.find((p) => p.path === shown);
	const pick = (p: string) =>
		onSearch({ ...search, path: `${prefix}${p}`, line: undefined });
	// A tree row's menu: the same file actions as the open file's header, plus Open diff.
	const rowCtx = (p: string): DiffFileCtx => {
		const at = cwdPath(workspace, repo.repo, p);
		return {
			openDiff: () => pick(p),
			viewFile: () =>
				onSearch({ ...search, path: `${prefix}${p}`, view: "file" }),
			openEditor: () => openInEditor(toast, runId, at),
			copyPath: () =>
				void copyText(at).then((ok) => ok && toast({ title: "Path copied" })),
			attach: () =>
				sendReference(threadId, {
					kind: "file",
					id: at,
					label: p.split("/").pop() ?? p,
				})
					? toast({ title: "Attached to your message" })
					: toast({ title: "Open the composer to attach" }),
			revert: () => undefined,
			facts: { is: { tree: true } },
		};
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
			<div className="flex shrink-0 flex-col shadow-[0_1px_0_var(--hairline)] @2xl:w-64 @2xl:shadow-[1px_0_0_var(--hairline)]">
				{counts.length > 1 && (
					<FileGroupBar
						counts={counts}
						hidden={hiddenSet}
						onToggle={onToggleGroup}
					/>
				)}
				<DiffTree
					files={visible}
					outside={outside}
					selected={shown}
					onPick={pick}
					rowCtx={rowCtx}
				/>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{file && (
					<FileDiffPane
						key={`${shown}:${scoped?.to ?? ""}`}
						runId={runId}
						threadId={threadId}
						workspace={workspace}
						repo={repo}
						scope={scope}
						path={file.path}
						status={file.status}
						inline={patch?.text ?? null}
						perFile={perFile}
						folded={foldsBehindLoad(file)}
						outside={outside.has(file.path)}
						line={asked === file.path ? (search.line ?? null) : null}
						style={style}
						wrap={wrap}
						onViewFile={(at) =>
							onSearch({
								...search,
								path: `${prefix}${file.path}`,
								view: "file",
								line: at,
							})
						}
					/>
				)}
			</div>
		</div>
	);
}

/** `path` as the workspace's cwd sees it: a multi-repo run keeps each repo in its own folder. */
export function cwdPath(ws: RunWorkspace, repo: string, path: string): string {
	return ws.layout === "multi" ? `${repo}/${path}` : path;
}

/** The file the tab opens on: the asked one, else the first modified, so its hunks can revert. */
export function pickShownFile(
	files: readonly { path: string; status: string }[],
	asked: string | null,
): string | null {
	if (asked && files.some((f) => f.path === asked)) return asked;
	return (
		files.find((f) => f.status === "modified")?.path ??
		files.find((f) => f.status !== "link")?.path ??
		files[0]?.path ??
		null
	);
}

/** "lines 3 to 5" for a hunk's Revert, from its last changed line back over its change. */
export function hunkLinesWord(h: PatchHunk): string {
	const n = h.side === "additions" ? h.additions : h.deletions;
	const first = Math.max(1, h.line - n + 1);
	return first === h.line ? `line ${h.line}` : `lines ${first} to ${h.line}`;
}
