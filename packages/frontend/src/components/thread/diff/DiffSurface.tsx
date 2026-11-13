// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type DiffLineAnnotation,
	type FileDiffMetadata,
	parsePatchFiles,
} from "@pierre/diffs";
import {
	CodeView,
	type CodeViewHandle,
	WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type {
	DiffScope,
	RevertChangesInput,
	RunWorkspace,
	WorktreeRepoChanges,
} from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
	MessageSquarePlus,
	MoreHorizontal,
	SlidersHorizontal,
	Undo2,
	WrapText,
} from "lucide-react";
import {
	type CSSProperties,
	type SyntheticEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Menu, Picker, type PickerOption } from "@/components/kit";
import { Block } from "@/components/kit/Block";
import { selectionIn } from "@/components/kit/block-composer";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { CODE_STYLE, POOL } from "@/components/run/EvidenceFileView";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { diffHunkBlock } from "@/components/thread/diff/file.blocks";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { copyText } from "@/lib/clipboard";
import {
	FILE_GROUP_IDS,
	type FileGroup,
	fileGroupOf,
	foldsBehindLoad,
} from "@/lib/file-groups";
import { useTheme } from "@/lib/providers/theme-provider";
import { splitPatch } from "@/lib/run-panel";
import { fileFlags, noiseLine, RISK_WORD, reviewTurn } from "@/lib/turn-review";
import { quoteOf, sendQuote, sendReference } from "../composer/quote";
import type { PanelSearch } from "../panel/panel-model";
import type { DiffFileCtx, DiffLineCtx } from "./diff.actions";
import { FileGroupBar, groupCounts, LoadMark } from "./FileGroups";
import { FileView } from "./FileView";
import type { DiffHunkData } from "./file.blocks";
import { type PatchHunk, patchLines } from "./patch-lines";
import { TurnUndo } from "./TurnUndo";
import {
	filePatchOptions,
	REVERT_BLOCK_WORDS,
	refusedWords,
	useFilePatch,
	useRevert,
	useScopedChanges,
} from "./use-scoped-changes";

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

const TREE_STYLE = {
	"--trees-fg-override": "var(--text-2)",
	"--trees-selected-bg-override": "var(--surface-3)",
	"--trees-border-color-override": "transparent",
	"--trees-bg-override": "transparent",
	"--trees-font-family-override": "var(--font-sans)",
	"--trees-input-bg-override": "var(--surface-2)",
	"--trees-search-bg-override": "var(--surface-2)",
	"--trees-search-fg-override": "var(--text-1)",
} as CSSProperties;

type ViewStyle = "auto" | "split" | "unified";
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
const SEPARATOR_CSS =
	'[data-unmodified-lines]{font-size:0}[data-unmodified-lines]::after{content:"Show more lines";font-size:var(--diffs-font-size,13px)}';

const OPEN_TREE_MAX_FILES = 200;

/** Split needs room for two columns of code; narrower goes unified by itself (#1101 category 16). */
const SPLIT_MIN_PX = 720;

type Note =
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
							{review.reviewed.files.length}{" "}
							{review.reviewed.files.length === 1 ? "file" : "files"}{" "}
							<span className="text-ok">+{review.reviewed.add}</span>{" "}
							<span className="text-danger">−{review.reviewed.del}</span>
							{noise && <span className="text-text-3"> · {noise}</span>}
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
				<Menu
					label="Diff view"
					entries={[
						...(["auto", "split", "unified"] as const).map((v) => ({
							id: `diff-style-${v}`,
							label:
								v === "auto" ? "Auto" : v === "split" ? "Split" : "Unified",
							checked: prefs.style === v,
							onSelect: () => setPrefs({ style: v }),
						})),
						{ id: "diff-view-sep", separator: true as const },
						{
							id: "diff-wrap",
							label: "Wrap lines",
							icon: WrapText,
							checked: prefs.wrap,
							onSelect: () => setPrefs({ wrap: !prefs.wrap }),
						},
					]}
					trigger={
						<button
							type="button"
							aria-label="Diff view"
							className="grid size-7 shrink-0 place-items-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:outline focus-visible:outline-accent data-[state=open]:bg-surface-3"
							data-testid="diff-view"
						>
							<SlidersHorizontal className="size-3.5" />
						</button>
					}
				/>
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

type OkRepo = Extract<WorktreeRepoChanges, { state: "ok" }>;

type RowDecoration = ReturnType<
	NonNullable<Parameters<typeof useFileTree>[0]["renderRowDecoration"]>
>;

type Toast = ReturnType<typeof useToast>["toast"];

/** Opens a workspace path in the host's editor; off the host it says to copy the path. */
function openInEditor(toast: Toast, runId: string, path: string, at?: number) {
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

/** The row a right-click or Shift+F10 landed on, through the tree's open shadow root. */
function treeRowPath(
	e: SyntheticEvent,
	host: HTMLElement | null,
): string | null {
	for (const el of e.nativeEvent.composedPath())
		if (el instanceof HTMLElement && el.dataset.itemPath)
			return el.dataset.itemPath;
	const active = host?.querySelector("*")?.shadowRoot?.activeElement;
	return active instanceof HTMLElement
		? (active.dataset.itemPath ?? null)
		: null;
}

/** The diff line a right-click landed on: its number and side. */
function diffLineAt(
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
						onViewFile={() =>
							onSearch({
								...search,
								path: `${prefix}${file.path}`,
								view: "file",
							})
						}
					/>
				)}
			</div>
		</div>
	);
}

function DiffTree({
	files,
	outside,
	selected,
	onPick,
	rowCtx,
}: {
	files: OkRepo["files"];
	outside: Set<string>;
	selected: string | null;
	onPick: (path: string) => void;
	rowCtx: (path: string) => DiffFileCtx;
}) {
	const [menuAt, setMenuAt] = useState<string | null>(null);
	const byPath = useRef(new Map(files.map((f) => [f.path, f])));
	byPath.current = new Map(files.map((f) => [f.path, f]));
	const out = useRef(outside);
	out.current = outside;
	const pick = useRef(onPick);
	pick.current = onPick;
	// Each row's marks, made once per answer: a scroll renders rows, never re-derives them (#1101 cat 16).
	const decor = useRef(new Map<string, RowDecoration>());
	const decorFor = useRef<[typeof files, Set<string>] | null>(null);
	if (decorFor.current?.[0] !== files || decorFor.current?.[1] !== outside) {
		decor.current = new Map();
		decorFor.current = [files, outside];
	}
	const paths = files.map((f) => f.path);
	const { model } = useFileTree({
		paths,
		// A huge diff opens two folders deep, an outline by area; a small one opens whole.
		initialExpansion: files.length > OPEN_TREE_MAX_FILES ? 2 : "open",
		flattenEmptyDirectories: true,
		search: true,
		density: "compact",
		// Fewer rows built per scroll step: a 900-file tree on a slow CPU stays under one frame budget.
		overscan: 4,
		stickyFolders: false,
		renderRowDecoration: ({ item }) => {
			if (!decor.current.has(item.path))
				decor.current.set(item.path, rowDecoration(item.path));
			return decor.current.get(item.path) ?? null;
		},
		onSelectionChange: (selection) => {
			const p = selection[0];
			if (p && !p.endsWith("/") && byPath.current.has(p)) pick.current(p);
		},
	});
	function rowDecoration(path: string): RowDecoration {
		const f = byPath.current.get(path);
		if (!f) return null;
		const isOut = out.current.has(f.path);
		const flags = fileFlags({
			path: f.path,
			add: f.additions ?? 0,
			del: f.deletions ?? 0,
			status: f.status,
		});
		const flagPart = flags.length
			? [{ text: "⚑  ", color: "var(--warn)" }]
			: [];
		const flagWords = flags.length
			? `${flags.map((x) => RISK_WORD[x]).join(", ")}. `
			: "";
		// The tree lays parts out as flex items, which drop plain spaces: NBSPs keep them apart.
		const outPart = isOut
			? [{ text: "outside  ", color: "var(--text-3)" }]
			: [];
		if (f.additions === null)
			return {
				text: `${isOut ? "outside  " : ""}${f.status === "link" ? "not captured" : f.status}`,
				title:
					f.status === "link" ? "A link or special file: never read" : f.status,
			};
		return {
			text: `${isOut ? "outside  " : ""}+${f.additions} −${f.deletions ?? 0}`,
			title: `${flagWords}${isOut ? "Changed between or after the agent's turns. " : ""}${f.additions} added, ${f.deletions ?? 0} removed`,
			parts: [
				...flagPart,
				...outPart,
				{ text: `+${f.additions}`, color: "var(--ok)" },
				{ text: ` −${f.deletions ?? 0}`, color: "var(--danger)" },
			],
		};
	}
	const key = paths.join("\0");
	const _markKey =
		files.map((f) => `${f.additions}:${f.deletions}`).join(",") +
		Array.from(outside).join(",");
	useEffect(() => {
		model.resetPaths(key ? key.split("\0") : []);
	}, [model, key]);
	useEffect(() => {
		if (selected) model.scrollToPath(selected, { focus: false });
	}, [model, selected]);
	const host = useRef<HTMLDivElement>(null);
	// The tree renders `role=tree` in an open shadow root with no label (#973 OBJ-010).
	useEffect(() => {
		const name = () => {
			const tree = host.current
				?.querySelector("*")
				?.shadowRoot?.querySelector("[role=tree]");
			tree?.setAttribute("aria-label", "Changed files");
			return !!tree;
		};
		if (name()) return;
		const t = window.setInterval(() => {
			if (name()) window.clearInterval(t);
		}, 50);
		return () => window.clearInterval(t);
	}, []);
	// Right-click, Shift+F10 and the Menu key name the row first; a folder or empty space keeps the browser's menu.
	const onMenu = (e: SyntheticEvent) => {
		const p = treeRowPath(e, host.current);
		if (!p || !byPath.current.has(p)) {
			e.stopPropagation();
			return;
		}
		setMenuAt(p);
	};
	return (
		<div
			className="contents"
			onContextMenuCapture={onMenu}
			data-testid="diff-files-menu"
		>
			<Surface id="diff.tree" ctx={rowCtx(menuAt ?? files[0]?.path ?? "")}>
				<div
					ref={host}
					className="h-44 shrink-0 contain-strict @2xl:h-auto @2xl:min-h-0 @2xl:flex-1"
					style={TREE_STYLE}
					data-testid="diff-files"
				>
					<FileTree model={model} style={{ height: "100%" }} />
				</div>
			</Surface>
		</div>
	);
}

/** `path` as the workspace's cwd sees it: a multi-repo run keeps each repo in its own folder. */
function cwdPath(ws: RunWorkspace, repo: string, path: string): string {
	return ws.layout === "multi" ? `${repo}/${path}` : path;
}

function FileDiffPane({
	runId,
	threadId,
	workspace,
	repo,
	scope,
	path,
	status,
	inline,
	perFile,
	folded,
	outside,
	line,
	style,
	wrap,
	onViewFile,
}: {
	onViewFile: () => void;
	runId: string;
	threadId: string;
	workspace: RunWorkspace;
	repo: OkRepo;
	scope: DiffScope;
	path: string;
	status: OkRepo["files"][number]["status"];
	/** The file's patch cut from a whole-diff answer; null when patches load per file. */
	inline: string | null;
	perFile: boolean;
	/** Its patch waits behind a Load mark (a lockfile, generated or very large). */
	folded: boolean;
	outside: boolean;
	line: number | null;
	style: ViewStyle;
	wrap: boolean;
}) {
	const { theme } = useTheme();
	const { toast } = useToast();
	const client = useQueryClient();
	const scoped = repo.scoped;
	const [loadAsked, setLoadAsked] = useState(false);
	const readable = status !== "link" && status !== "submodule";
	const remote = useFilePatch(
		runId,
		repo.repo,
		scoped,
		path,
		perFile && readable && (!folded || loadAsked),
	);
	const patch =
		inline ?? (remote.data?.state === "ok" ? remote.data.patch : null);
	const waiting = perFile && readable && folded && !loadAsked && !inline;
	const view = useRef<CodeViewHandle<Note, undefined>>(null);
	const box = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const split =
		style === "split" || (style === "auto" && width >= SPLIT_MIN_PX);
	const lines = useMemo(() => (patch ? patchLines(patch) : null), [patch]);
	const fileDiff = useMemo<FileDiffMetadata | null>(() => {
		if (!patch) return null;
		try {
			return (
				parsePatchFiles(patch, `${scoped?.to ?? ""}:${path}`)[0]?.files[0] ??
				null
			);
		} catch {
			return null;
		}
	}, [patch, path, scoped?.to]);
	const [draft, setDraft] = useState<{
		side: "additions" | "deletions";
		lineNumber: number;
	} | null>(null);
	const [added, setAdded] = useState<DiffLineAnnotation<Note>[]>([]);
	const [confirm, setConfirm] = useState<
		{ kind: "file" } | { kind: "hunk"; hunk: PatchHunk } | null
	>(null);
	const revert = useRevert(runId);
	const canRevert = !!scoped && scoped.revert === null && status !== "link";
	const annotations = useMemo<DiffLineAnnotation<Note>[]>(
		() => [
			...(scoped && status === "modified" && lines && !lines.wholeFileOnly
				? lines.hunks
						.filter((h) => h.line > 0)
						.map((hunk) => ({
							side: hunk.side,
							lineNumber: hunk.line,
							metadata: { kind: "hunk" as const, hunk },
						}))
				: []),
			...added,
			...(draft ? [{ ...draft, metadata: { kind: "draft" as const } }] : []),
		],
		[scoped, status, lines, added, draft],
	);
	// The library re-renders an item's annotations only when its version moves.
	const revision = useRef(0);
	const items = useMemo(
		() =>
			fileDiff
				? [
						{
							id: path,
							type: "diff" as const,
							fileDiff,
							annotations,
							version: ++revision.current,
						},
					]
				: [],
		[fileDiff, annotations, path],
	);
	useEffect(() => {
		if (!line || !fileDiff) return;
		const t = window.setTimeout(
			() =>
				view.current?.scrollTo({
					type: "line",
					id: path,
					lineNumber: line,
					side: "additions",
					align: "center",
				}),
			0,
		);
		return () => window.clearTimeout(t);
	}, [line, fileDiff, path]);

	const loadFiles = useCallback(async () => {
		const read = async (commit: string) => {
			const r = await orpc.investigations.getChangesFile.call({
				id: runId,
				repo: repo.repo,
				commit,
				path,
			});
			return r.state === "ok" ? { name: path, contents: r.contents } : null;
		};
		if (!scoped) throw new Error("No snapshot");
		const [oldFile, newFile] = await Promise.all([
			status === "added" ? null : read(scoped.from),
			status === "deleted" ? null : read(scoped.to),
		]);
		if (oldFile && newFile) return { oldFile, newFile };
		if (newFile && status === "added") return { oldFile: null, newFile };
		throw new Error("File contents unavailable");
	}, [runId, repo.repo, path, scoped, status]);

	const textAt = (side: "additions" | "deletions", n: number) =>
		(side === "additions" ? lines?.new : lines?.old)?.get(n) ?? "";
	// A change's new lines: what Copy takes; a pure deletion has none.
	const hunkData = (h: PatchHunk): DiffHunkData => {
		const first = Math.max(1, h.line - h.additions + 1);
		const added = h.side === "additions" && h.additions > 0;
		return {
			path: cwdPath(workspace, repo.repo, path),
			text: added
				? Array.from({ length: h.line - first + 1 }, (_, i) =>
						textAt("additions", first + i),
					).join("\n")
				: "",
			line: added ? first : h.line,
			end: h.line,
		};
	};

	// The line a right-click or Shift+F10 named; its menu reads it (#1125).
	const [lineAt, setLineAt] = useState<{
		side: "additions" | "deletions";
		n: number;
	} | null>(null);
	const lineCtx = (
		at: { side: "additions" | "deletions"; n: number } | null,
	): DiffLineCtx => {
		const side = at?.side ?? "additions";
		const n = at?.n ?? 1;
		return {
			comment: () => setDraft({ side, lineNumber: n }),
			// A selection in the diff quotes its lines; none quotes the line the menu named.
			quote: () => {
				const sel = selectionIn(box.current, true);
				const chip = quoteOf(sel?.text || textAt(side, n) || " ", {
					threadId,
					kind: "diff",
					path: `${repo.repo}:${path}`,
					line: sel?.lines?.[0] ?? n,
					side: side === "deletions" ? "old" : "new",
				});
				if (chip && sendQuote(threadId, chip))
					toast({ title: "Added to your message" });
				else toast({ title: "Open the composer to add" });
			},
			copy: () =>
				void copyText(textAt(side, n)).then(
					(ok) => ok && toast({ title: "Line copied" }),
				),
			openEditor: () => openEditor(n),
			facts: {},
		};
	};

	const doRevert = async (
		target: RevertChangesInput["target"],
		label: string,
	) => {
		if (!scoped) return;
		// A summary carries no states: the file's own patch answer says what the revert expects.
		const at =
			scoped.states[path] ??
			(perFile && readable
				? await client
						.fetchQuery(filePatchOptions(runId, repo.repo, scoped, path))
						.then((p) => (p.state === "ok" ? p.at : undefined))
						.catch(() => undefined)
				: undefined);
		const r = await revert.mutateAsync({
			repo: repo.repo,
			scope,
			...(scoped.turn !== null ? { turn: scoped.turn } : {}),
			from: scoped.from,
			target,
			expect: { [path]: at ?? "absent" },
		});
		if (r.state === "refused") {
			toast({
				title: "Not reverted",
				description: refusedWords(r),
				variant: "destructive",
			});
			return;
		}
		toast({
			title: `Reverted ${label}`,
			action: (
				<ToastAction
					altText="Undo the revert"
					onClick={() =>
						void revert
							.mutateAsync({
								repo: repo.repo,
								scope,
								from: scoped.from,
								target: { kind: "undo", revertId: r.revertId },
								expect: {},
							})
							.then((u) =>
								toast(
									u.state === "done"
										? { title: "Revert undone" }
										: {
												title: "Not undone",
												description: refusedWords(u),
												variant: "destructive",
											},
								),
							)
					}
					data-testid="diff-undo-revert"
				>
					Undo
				</ToastAction>
			),
		});
	};

	const editorPath = cwdPath(workspace, repo.repo, path);
	const openEditor = (at?: number) =>
		openInEditor(toast, runId, editorPath, at);

	const file = repo.files.find((f) => f.path === path);
	const fileCtx: DiffFileCtx = {
		viewFile: onViewFile,
		openEditor: () => openEditor(line ?? undefined),
		copyPath: () =>
			void copyText(editorPath).then(
				(ok) => ok && toast({ title: "Path copied" }),
			),
		attach: () =>
			sendReference(threadId, {
				kind: "file",
				id: editorPath,
				label: path.split("/").pop() ?? path,
			})
				? toast({ title: "Attached to your message" })
				: toast({ title: "Open the composer to attach" }),
		revert: () => setConfirm({ kind: "file" }),
		facts: {
			is: { revertable: !!scoped && canRevert, busy: revert.isPending },
		},
	};
	return (
		<div
			ref={box}
			className="flex min-h-0 flex-1 flex-col"
			data-testid="diff-file-pane"
			data-split={split ? "split" : "unified"}
		>
			<Surface id="diff.file" ctx={fileCtx}>
				<div className="flex shrink-0 items-center gap-1.5 px-2 py-1 shadow-[0_1px_0_var(--hairline)]">
					<FileName path={path} />
					{outside && (
						<Hint label="Changed between or after the agent's turns">
							<span
								className="shrink-0 text-meta text-text-3"
								data-testid="diff-outside-mark"
							>
								outside
							</span>
						</Hint>
					)}
					{file?.additions !== null && file && (
						<span className="shrink-0 text-meta tabular-nums">
							<span className="text-ok">+{file.additions}</span>{" "}
							<span className="text-danger">−{file.deletions ?? 0}</span>
						</span>
					)}
					{scoped && (
						<Hint
							label={
								scoped.revert
									? REVERT_BLOCK_WORDS[scoped.revert]
									: canRevert &&
											(status === "added" ||
												status === "deleted" ||
												lines?.wholeFileOnly)
										? "Reverts as a whole file"
										: "Revert this file to the scope's start"
							}
						>
							<span className="shrink-0">
								<Button
									variant="text"
									size="sm"
									disabled={!canRevert || revert.isPending}
									onClick={() => setConfirm({ kind: "file" })}
									data-testid="diff-revert-file"
								>
									<Undo2 className="size-3.5" />
									Revert file
								</Button>
							</span>
						</Hint>
					)}
					<SurfaceMore
						id="diff.file"
						ctx={fileCtx}
						trigger={
							<button
								type="button"
								aria-label="File actions"
								className="grid size-7 shrink-0 place-items-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:outline focus-visible:outline-accent data-[state=open]:bg-surface-3"
								data-testid="diff-file-more"
							>
								<MoreHorizontal className="size-3.5" />
							</button>
						}
					/>
				</div>
			</Surface>
			{scoped?.revert && (
				<p
					className="shrink-0 px-3 pt-1.5 text-meta text-text-2"
					data-testid="diff-revert-blocked"
				>
					{REVERT_BLOCK_WORDS[scoped.revert]}
				</p>
			)}
			{status === "link" ? (
				<Empty
					className="px-3"
					text="Linked file, never read"
					testId="diff-linked-file"
				/>
			) : waiting ? (
				<LoadMark
					path={path}
					additions={file?.additions ?? null}
					deletions={file?.deletions ?? null}
					onLoad={() => setLoadAsked(true)}
				/>
			) : perFile && readable && remote.isLoading ? (
				<div className="px-3 pt-3">
					<Loading rows={6} />
				</div>
			) : perFile && readable && remote.error ? (
				<Problem
					className="px-3"
					text="Diff did not load"
					onRetry={() => void remote.refetch()}
				/>
			) : !fileDiff ? (
				<Empty
					className="px-3"
					text={
						repo.omitted === "too-large" || remote.data?.state === "unavailable"
							? "Too large to show"
							: "No text changes"
					}
					testId="diff-no-patch"
				/>
			) : (
				<WorkerPoolContextProvider {...POOL}>
					<div
						className="contents"
						onContextMenuCapture={(e) => {
							const at =
								diffLineAt(e) ??
								(line ? { side: "additions" as const, n: line } : null);
							if (!at) {
								e.stopPropagation();
								return;
							}
							setLineAt(at);
						}}
					>
						<Surface id="diff.line" ctx={lineCtx(lineAt)}>
							<section
								// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to scroll by keyboard.
								tabIndex={0}
								aria-label={`Changes to ${path}`}
								onPointerOver={(e) => nameGutterButtons(e.currentTarget)}
								className="flex min-h-0 flex-1 flex-col outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
								style={CODE_STYLE}
								data-testid="diff-patch"
							>
								<CodeView<Note>
									ref={view}
									items={items}
									className="min-h-0 flex-1 overflow-auto"
									options={{
										diffStyle: split ? "split" : "unified",
										overflow: wrap ? "wrap" : "scroll",
										themeType: theme === "dark" ? "dark" : "light",
										disableFileHeader: true,
										preferredHighlighter: "shiki-js",
										enableGutterUtility: true,
										hunkSeparators: "line-info",
										unsafeCSS: SEPARATOR_CSS,
										expansionLineCount: 20,
										loadDiffFiles: loadFiles,
										// The library takes the click on its gutter slot (the slot sits under its own layer).
										// A line number opens a comment too: a larger target than the `+`.
										onLineNumberClick: (p) => {
											if ("annotationSide" in p)
												setDraft({
													side: p.annotationSide,
													lineNumber: p.lineNumber,
												});
										},
										onGutterUtilityClick: (range) =>
											setDraft({
												side: range.side ?? "additions",
												lineNumber: range.start,
											}),
									}}
									renderAnnotation={(a) => {
										const note = a.metadata;
										if (!note || !("side" in a)) return null;
										if (note.kind === "hunk")
											return (
												<Block
													spec={diffHunkBlock}
													data={hunkData(note.hunk)}
													reveal="always"
												>
													{(chrome) => (
														<div
															className="flex items-center justify-end gap-1 px-2 py-1 font-sans text-meta"
															data-testid="diff-hunk-bar"
														>
															{chrome}
															<button
																type="button"
																disabled={!canRevert || revert.isPending}
																aria-label={`Revert this change in ${path}, ${hunkLinesWord(note.hunk)}${scoped?.revert ? `. ${REVERT_BLOCK_WORDS[scoped.revert]}` : ""}`}
																onClick={() =>
																	setConfirm({ kind: "hunk", hunk: note.hunk })
																}
																className="inline-flex h-6 shrink-0 items-center gap-1 rounded-control bg-surface-3 px-2 text-text-1 outline-none hover:bg-surface-4 focus-visible:outline focus-visible:outline-offset-1 focus-visible:outline-accent disabled:text-text-3"
																data-testid="diff-revert-hunk"
															>
																<Undo2 aria-hidden className="size-3" />
																Revert this change
															</button>
														</div>
													)}
												</Block>
											);
										if (note.kind === "added")
											return (
												<p
													className="m-0 px-2 py-1 text-meta text-text-2"
													data-testid="diff-comment-added"
												>
													<MessageSquarePlus className="mr-1 inline size-3" />
													In your message: {note.text}
												</p>
											);
										return (
											<CommentBox
												onCancel={() => setDraft(null)}
												onAdd={(text) => {
													const quoted = textAt(a.side, a.lineNumber) || " ";
													const chip = quoteOf(quoted, {
														threadId,
														kind: "diff",
														path: `${repo.repo}:${path}`,
														line: a.lineNumber,
														side: a.side === "deletions" ? "old" : "new",
													});
													if (!chip) return;
													chip.quote = { ...chip.quote, comment: text };
													if (!sendQuote(threadId, chip)) {
														toast({ title: "Open the composer to comment" });
														return;
													}
													setAdded((x) => [
														...x,
														{
															side: a.side,
															lineNumber: a.lineNumber,
															metadata: { kind: "added", text },
														},
													]);
													setDraft(null);
												}}
											/>
										);
									}}
								/>
							</section>
						</Surface>
					</div>
				</WorkerPoolContextProvider>
			)}
			<AlertDialog
				open={!!confirm}
				onOpenChange={(o) => !o && setConfirm(null)}
			>
				<AlertDialogContent data-testid="diff-revert-confirm">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirm?.kind === "hunk"
								? `Revert this change in ${path}?`
								: `Revert ${path}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm?.kind === "hunk"
								? `Takes back ${confirm.hunk.additions} added and ${confirm.hunk.deletions} removed ${confirm.hunk.additions + confirm.hunk.deletions === 1 ? "line" : "lines"} in the thread's worktree.`
								: status === "added"
									? "Deletes this new file from the thread's worktree."
									: `Sets the file back to how it was at the start of ${SCOPE_WORDS[scope].label.toLowerCase()}.`}{" "}
							You can undo it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								const c = confirm;
								setConfirm(null);
								if (c?.kind === "hunk")
									void doRevert(
										{ kind: "hunk", path, header: c.hunk.header },
										`a change in ${path}`,
									);
								else void doRevert({ kind: "file", path }, path);
							}}
							data-testid="diff-revert-confirm-action"
						>
							Revert
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
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

/** The library's line `+` has no name of its own; it lives in an open shadow root. */
function nameGutterButtons(root: HTMLElement) {
	root.querySelectorAll("*").forEach((host) => {
		host.shadowRoot
			?.querySelectorAll("[data-utility-button]:not([aria-label])")
			.forEach((b) => {
				b.setAttribute("aria-label", "Comment on this line");
			});
	});
}

/** The file name stays whole; a long directory gives way from its left end. */
function FileName({ path }: { path: string }) {
	const cut = path.lastIndexOf("/");
	const dir = cut >= 0 ? path.slice(0, cut + 1) : "";
	const name = path.slice(cut + 1);
	return (
		<span
			className="flex min-w-0 flex-1 items-baseline font-mono text-mono"
			data-testid="diff-file-name"
		>
			{dir && (
				<span dir="rtl" className="min-w-0 truncate text-left text-text-3">
					{`‎${dir}‎`}
				</span>
			)}
			<span className="min-w-0 shrink-[0.0001] truncate text-text-1">
				{name}
			</span>
		</span>
	);
}

function CommentBox({
	onAdd,
	onCancel,
}: {
	onAdd: (text: string) => void;
	onCancel: () => void;
}) {
	const [text, setText] = useState("");
	return (
		<div
			className="flex flex-col gap-1.5 px-2 py-2 font-sans"
			data-testid="diff-comment-box"
		>
			<Textarea
				autoFocus
				aria-label="Comment for the agent"
				placeholder="What should the agent change here?"
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") onCancel();
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim())
						onAdd(text.trim());
				}}
				rows={2}
			/>
			<div className="flex justify-end gap-1">
				<Button variant="text" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					size="sm"
					disabled={!text.trim()}
					onClick={() => onAdd(text.trim())}
					data-testid="diff-comment-add"
				>
					Add to message
				</Button>
			</div>
		</div>
	);
}
