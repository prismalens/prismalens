// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// One file's patch: the diff library and its highlighter, loaded after the tree paints (#1101 category 12).

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
import type {
	DiffScope,
	RevertChangesInput,
	RunWorkspace,
} from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, MoreHorizontal, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTheme } from "@/lib/providers/theme-provider";
import { quoteOf, sendQuote, sendReference } from "../composer/quote";
import {
	cwdPath,
	diffLineAt,
	hunkLinesWord,
	type Note,
	type OkRepo,
	openInEditor,
	SCOPE_WORDS,
	SEPARATOR_CSS,
	SPLIT_MIN_PX,
	type ViewStyle,
} from "./DiffSurface";
import type { DiffFileCtx, DiffLineCtx } from "./diff.actions";
import { LoadMark } from "./FileGroups";
import type { DiffHunkData } from "./file.blocks";
import { type PatchHunk, patchLines } from "./patch-lines";
import {
	filePatchOptions,
	REVERT_BLOCK_WORDS,
	refusedWords,
	useFilePatch,
	useRevert,
} from "./use-scoped-changes";

export function FileDiffPane({
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
