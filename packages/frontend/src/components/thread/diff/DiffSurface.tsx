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
import {
	Copy,
	ExternalLink,
	FileText,
	MessageSquarePlus,
	Paperclip,
	Undo2,
	WrapText,
} from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CODE_STYLE, POOL } from "@/components/run/EvidenceFileView";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading, Problem } from "@/components/shared/State";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { useTheme } from "@/lib/providers/theme-provider";
import { splitPatch } from "@/lib/run-panel";
import { cn } from "@/lib/utils";
import { quoteOf, sendQuote, sendReference } from "../composer/quote";
import type { PanelSearch } from "../panel/panel-model";
import { FileView } from "./FileView";
import { type PatchHunk, patchLines } from "./patch-lines";
import { TurnUndo } from "./TurnUndo";
import {
	REVERT_BLOCK_WORDS,
	refusedWords,
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

function readPrefs(): { style: ViewStyle; wrap: boolean } {
	try {
		const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
			style?: unknown;
			wrap?: unknown;
		};
		return {
			style: v.style === "split" || v.style === "unified" ? v.style : "auto",
			wrap: v.wrap !== false,
		};
	} catch {
		return { style: "auto", wrap: true };
	}
}

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
	return (
		<div
			className="flex min-h-0 flex-1 flex-col @container"
			data-testid="diff-surface"
			data-scope={scope}
		>
			<div
				role="toolbar"
				aria-label="Diff"
				className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1.5 shadow-[0_1px_0_var(--hairline)]"
			>
				<fieldset
					aria-label="Compare"
					className="m-0 flex shrink-0 gap-0.5 border-0 p-0"
				>
					{SCOPES.map((s) => (
						<Hint key={s} label={SCOPE_WORDS[s].detail}>
							<button
								type="button"
								aria-pressed={scope === s}
								onClick={() =>
									onSearch({
										scope: s,
										...(s === "turn" && search.turn !== undefined
											? { turn: search.turn }
											: {}),
									})
								}
								className={cn(
									"h-6 shrink-0 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
									scope === s
										? "bg-surface-3 text-text-1"
										: "text-text-2 hover:text-text-1",
								)}
								data-testid={`diff-scope-${s}`}
							>
								{SCOPE_WORDS[s].label}
							</button>
						</Hint>
					))}
				</fieldset>
				{scope === "turn" && turns.length > 1 && (
					<Select
						value={String(scoped?.turn ?? "")}
						onValueChange={(v) => onSearch({ scope: "turn", turn: Number(v) })}
					>
						<SelectTrigger aria-label="Turn" data-testid="diff-turn">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{turns.map((t, i) => (
								<SelectItem key={t.seq} value={String(t.seq)}>
									Turn {i + 1}
									{t.ended ? "" : " (working)"}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{scope === "turn" &&
					scoped?.turn !== null &&
					scoped?.turn !== undefined && (
						<TurnUndo runId={runId} turnId={scoped.turn} repo={ok?.repo} />
					)}
			</div>
			{repos.length > 1 && (
				<fieldset
					aria-label="Repository"
					className="m-0 flex shrink-0 flex-wrap gap-1 border-0 px-3 pt-2"
				>
					{repos.map((r, i) => (
						<button
							key={r.repo}
							type="button"
							aria-pressed={r === repo}
							onClick={() => setRepoAt(i)}
							className={cn(
								"h-6 rounded-[4px] px-2 text-meta",
								r === repo ? "bg-surface-3 text-text-1" : "text-text-2",
							)}
						>
							{r.repo}
						</button>
					))}
				</fieldset>
			)}
			<div className="flex shrink-0 items-center gap-1 px-3 pt-1.5 pb-1">
				<p
					className="m-0 min-w-0 flex-1 truncate text-meta text-text-2"
					data-testid="diff-scope-named"
				>
					{SCOPE_WORDS[scope].label}
					{ok && (
						<>
							{" · "}
							{ok.files.length} {ok.files.length === 1 ? "file" : "files"}{" "}
							<span className="text-ok">+{ok.additions}</span>{" "}
							<span className="text-danger">−{ok.deletions}</span>
							{scoped?.live ? " · working" : ""}
						</>
					)}
				</p>
				<fieldset
					aria-label="Layout"
					className="m-0 flex shrink-0 gap-0.5 border-0 p-0"
				>
					{(["auto", "split", "unified"] as const).map((v) => (
						<button
							key={v}
							type="button"
							aria-pressed={prefs.style === v}
							onClick={() => setPrefs({ style: v })}
							className={cn(
								"h-6 shrink-0 rounded-[4px] px-1.5 text-meta",
								prefs.style === v
									? "bg-surface-3 text-text-1"
									: "text-text-3 hover:text-text-1",
							)}
							data-testid={`diff-style-${v}`}
						>
							{v === "auto" ? "Auto" : v === "split" ? "Split" : "Unified"}
						</button>
					))}
				</fieldset>
				<Hint label={prefs.wrap ? "Don't wrap lines" : "Wrap lines"}>
					<button
						type="button"
						aria-label="Wrap lines"
						aria-pressed={prefs.wrap}
						onClick={() => setPrefs({ wrap: !prefs.wrap })}
						className={cn(
							"grid size-6 shrink-0 place-items-center rounded-[4px]",
							prefs.wrap ? "bg-surface-3 text-text-1" : "text-text-3",
						)}
						data-testid="diff-wrap"
					>
						<WrapText className="size-3.5" />
					</button>
				</Hint>
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
					search={search}
					onSearch={onSearch}
				/>
			)}
		</div>
	);
}

type OkRepo = Extract<WorktreeRepoChanges, { state: "ok" }>;

function RepoDiff({
	runId,
	threadId,
	workspace,
	repo,
	scope,
	style,
	wrap,
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
	search: PanelSearch;
	onSearch: (next: PanelSearch) => void;
}) {
	const scoped = repo.scoped;
	const patches = useMemo(
		() => (repo.patch ? splitPatch(repo.patch) : []),
		[repo.patch],
	);
	const prefix = `${repo.repo}:`;
	const asked = search.path?.startsWith(prefix)
		? search.path.slice(prefix.length)
		: null;
	const shown = pickShownFile(repo.files, asked);
	const outside = new Set(scoped?.outside ?? []);
	if (repo.files.length === 0)
		return (
			<Empty className="px-3" text="No changes here" testId="diff-empty" />
		);
	const file = repo.files.find((f) => f.path === shown);
	const patch = patches.find((p) => p.path === shown);
	return (
		<div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
			<DiffTree
				files={repo.files}
				outside={outside}
				selected={shown}
				onPick={(p) =>
					onSearch({ ...search, path: `${prefix}${p}`, line: undefined })
				}
			/>
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
						patch={patch?.text ?? null}
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
}: {
	files: OkRepo["files"];
	outside: Set<string>;
	selected: string | null;
	onPick: (path: string) => void;
}) {
	const byPath = useRef(new Map(files.map((f) => [f.path, f])));
	byPath.current = new Map(files.map((f) => [f.path, f]));
	const out = useRef(outside);
	out.current = outside;
	const pick = useRef(onPick);
	pick.current = onPick;
	const paths = files.map((f) => f.path);
	const { model } = useFileTree({
		paths,
		initialExpansion: "open",
		flattenEmptyDirectories: true,
		search: true,
		density: "compact",
		renderRowDecoration: ({ item }) => {
			const f = byPath.current.get(item.path);
			if (!f) return null;
			const mark = out.current.has(f.path) ? "outside " : "";
			if (f.additions === null)
				return {
					text: `${mark}${f.status === "link" ? "not captured" : f.status}`,
					title:
						f.status === "link"
							? "A link or special file: never read"
							: f.status,
				};
			return {
				text: `${mark}+${f.additions} −${f.deletions ?? 0}`,
				title: `${out.current.has(f.path) ? "Changed outside the agent's turns. " : ""}${f.additions} added, ${f.deletions ?? 0} removed`,
				parts: [
					...(mark ? [{ text: "outside ", color: "var(--warn)" }] : []),
					{ text: `+${f.additions}`, color: "var(--ok)" },
					{ text: ` −${f.deletions ?? 0}`, color: "var(--danger)" },
				],
			};
		},
		onSelectionChange: (selection) => {
			const p = selection[0];
			if (p && !p.endsWith("/") && byPath.current.has(p)) pick.current(p);
		},
	});
	const key = paths.join("\0");
	const markKey =
		files.map((f) => `${f.additions}:${f.deletions}`).join(",") +
		Array.from(outside).join(",");
	useEffect(() => {
		model.resetPaths(key ? key.split("\0") : []);
	}, [model, key, markKey]);
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
	return (
		<div
			ref={host}
			className="h-44 shrink-0 shadow-[0_1px_0_var(--hairline)] @2xl:h-auto @2xl:w-64 @2xl:shadow-[1px_0_0_var(--hairline)]"
			style={TREE_STYLE}
			data-testid="diff-files"
		>
			<FileTree model={model} style={{ height: "100%" }} />
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
	patch,
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
	patch: string | null;
	outside: boolean;
	line: number | null;
	style: ViewStyle;
	wrap: boolean;
}) {
	const { theme } = useTheme();
	const { toast } = useToast();
	const scoped = repo.scoped;
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

	const doRevert = async (
		target: RevertChangesInput["target"],
		label: string,
	) => {
		if (!scoped) return;
		const r = await revert.mutateAsync({
			repo: repo.repo,
			scope,
			...(scoped.turn !== null ? { turn: scoped.turn } : {}),
			from: scoped.from,
			target,
			expect: { [path]: scoped.states[path] ?? "absent" },
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
		void orpc.runWorkspaces.openInEditor
			.call({ id: runId, path: editorPath, ...(at ? { line: at } : {}) })
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

	const file = repo.files.find((f) => f.path === path);
	return (
		<div
			ref={box}
			className="flex min-h-0 flex-1 flex-col"
			data-testid="diff-file-pane"
			data-split={split ? "split" : "unified"}
		>
			<div className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1.5 shadow-[0_1px_0_var(--hairline)]">
				<span
					className="min-w-0 flex-1 truncate font-mono text-mono text-text-1"
					title={undefined}
				>
					{path}
				</span>
				{outside && (
					<span
						className="shrink-0 text-meta text-warn"
						data-testid="diff-outside-mark"
					>
						Changed outside the agent's turns
					</span>
				)}
				{file?.additions !== null && file && (
					<span className="shrink-0 text-meta tabular-nums">
						<span className="text-ok">+{file.additions}</span>{" "}
						<span className="text-danger">−{file.deletions ?? 0}</span>
					</span>
				)}
				<FileAction
					label="View file"
					onClick={onViewFile}
					icon={<FileText className="size-3.5" />}
					testId="diff-view-file"
				/>
				<FileAction
					label="Open in editor"
					onClick={() => openEditor(line ?? undefined)}
					icon={<ExternalLink className="size-3.5" />}
					testId="diff-open-editor"
				/>
				<FileAction
					label="Copy path"
					onClick={() =>
						void navigator.clipboard
							.writeText(editorPath)
							.then(() => toast({ title: "Path copied" }))
					}
					icon={<Copy className="size-3.5" />}
					testId="diff-copy-path"
				/>
				<FileAction
					label="Attach to message"
					onClick={() =>
						sendReference(threadId, {
							kind: "file",
							id: editorPath,
							label: path.split("/").pop() ?? path,
						})
							? toast({ title: "Attached to your message" })
							: toast({ title: "Open the composer to attach" })
					}
					icon={<Paperclip className="size-3.5" />}
					testId="diff-attach"
				/>
				{scoped &&
					canRevert &&
					(status === "added" ||
						status === "deleted" ||
						lines?.wholeFileOnly) && (
						<span
							className="shrink-0 text-meta text-text-3"
							data-testid="diff-whole-file-note"
						>
							Reverts as a whole file
						</span>
					)}
				{scoped && (
					<Hint
						label={
							scoped.revert
								? REVERT_BLOCK_WORDS[scoped.revert]
								: "Revert this file to the scope's start"
						}
					>
						<span>
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
			</div>
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
			) : !fileDiff ? (
				<Empty
					className="px-3"
					text={
						repo.omitted === "too-large"
							? "Too large to show"
							: "No text changes"
					}
					testId="diff-no-patch"
				/>
			) : (
				<WorkerPoolContextProvider {...POOL}>
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
										<div
											className="flex items-center justify-end px-2 py-1 font-sans text-meta"
											data-testid="diff-hunk-bar"
										>
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

function FileAction({
	label,
	onClick,
	icon,
	testId,
}: {
	label: string;
	onClick: () => void;
	icon: React.ReactNode;
	testId: string;
}) {
	return (
		<Hint label={label}>
			<Button
				variant="text"
				size="icon"
				aria-label={label}
				onClick={onClick}
				data-testid={testId}
			>
				{icon}
			</Button>
		</Hint>
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
