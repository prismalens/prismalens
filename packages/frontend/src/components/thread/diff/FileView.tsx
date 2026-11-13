// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { FileContents } from "@pierre/diffs";
import {
	CodeView,
	type CodeViewHandle,
	WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import type { RunWorkspace } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import {
	ChevronLeft,
	ExternalLink,
	FileDiff,
	Link2,
	Paperclip,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Block } from "@/components/kit/Block";
import { CODE_STYLE, POOL } from "@/components/run/EvidenceFileView";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading } from "@/components/shared/State";
import { fileExcerptBlock } from "@/components/thread/diff/file.blocks";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { useTheme } from "@/lib/providers/theme-provider";
import { sendReference } from "../composer/quote";
import { fileLines } from "./file.blocks";
import { useScopedChanges } from "./use-scoped-changes";

const UNAVAILABLE = {
	absent: "Not in the worktree now",
	binary: "Binary file",
	"too-large": "Too large to show",
	"no-workspace": "Worktree not available",
} as const;

/**
 * One file of the thread's worktree as it is now, the cited line selected (#1101 categories
 * 16 and 21): Open in editor at that line, Copy path, Attach to message, Show changes.
 */
export function FileView({
	runId,
	threadId,
	workspace,
	repo,
	path,
	line,
	live,
	onBack,
	backLabel,
	onShowChanges,
}: {
	runId: string;
	threadId: string;
	workspace: RunWorkspace;
	repo: string;
	path: string;
	line: number | null;
	live: boolean;
	onBack?: () => void;
	backLabel?: string;
	onShowChanges?: () => void;
}) {
	const { theme } = useTheme();
	const { toast } = useToast();
	const now = useScopedChanges(runId, "uncommitted", undefined, live);
	const r = now.data?.repos.find((x) => x.repo === repo);
	const commit = r?.state === "ok" ? r.scoped?.to : undefined;
	const changed = r?.state === "ok" && r.files.some((f) => f.path === path);
	const file = useQuery({
		...orpc.investigations.getChangesFile.queryOptions({
			input: { id: runId, repo, commit: commit ?? "", path },
		}),
		enabled: !!commit,
		retry: false,
	});
	const view = useRef<CodeViewHandle<undefined, undefined>>(null);
	const items = useMemo(() => {
		if (file.data?.state !== "ok" || !commit) return [];
		const f: FileContents = {
			name: path,
			contents: file.data.contents,
			cacheKey: `${commit}:${path}`,
		};
		return [{ id: path, type: "file" as const, file: f }];
	}, [file.data, commit, path]);
	const range = line ? { start: line, end: line } : null;
	useEffect(() => {
		if (!line || !items.length) return;
		const t = window.setTimeout(
			() =>
				view.current?.scrollTo({
					type: "line",
					id: path,
					lineNumber: line,
					align: "center",
				}),
			0,
		);
		return () => window.clearTimeout(t);
	}, [line, items.length, path]);
	const editorPath = workspace.layout === "multi" ? `${repo}/${path}` : path;
	const contents = file.data?.state === "ok" ? file.data.contents : "";
	return (
		<Block
			spec={fileExcerptBlock}
			data={{ path: editorPath, contents, line: line ?? undefined }}
			className="flex min-h-0 flex-1 flex-col"
			testId="file-view"
			shadow
			linesText={(a, b) => fileLines(contents, a, b)}
		>
			{(chrome) => (
				<>
					<div className="flex shrink-0 items-center gap-1 px-2 py-1.5 shadow-[0_1px_0_var(--hairline)]">
						{onBack && (
							<Button
								variant="text"
								size="sm"
								onClick={onBack}
								data-testid="file-view-back"
							>
								<ChevronLeft className="size-3.5" />
								{backLabel ?? "Back"}
							</Button>
						)}
						<span className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
							{path}
							{line ? <span className="text-text-3">:{line}</span> : null}
						</span>
						{changed && onShowChanges && (
							<Hint label="Show changes">
								<Button
									variant="text"
									size="icon"
									aria-label="Show changes"
									onClick={onShowChanges}
									data-testid="file-view-changes"
								>
									<FileDiff className="size-3.5" />
								</Button>
							</Hint>
						)}
						<Hint label="Open in editor">
							<Button
								variant="text"
								size="icon"
								aria-label="Open in editor"
								onClick={() =>
									void orpc.runWorkspaces.openInEditor
										.call({
											id: runId,
											path: editorPath,
											...(line ? { line } : {}),
										})
										.then((x) =>
											x.opened ? null : toast({ title: "No editor opened" }),
										)
										.catch(() => toast({ title: "Opens only on the host" }))
								}
								data-testid="file-view-editor"
							>
								<ExternalLink className="size-3.5" />
							</Button>
						</Hint>
						<Hint label="Copy path">
							<Button
								variant="text"
								size="icon"
								aria-label="Copy path"
								onClick={() =>
									void navigator.clipboard
										.writeText(editorPath)
										.then(() => toast({ title: "Path copied" }))
								}
								data-testid="file-view-copy"
							>
								<Link2 className="size-3.5" />
							</Button>
						</Hint>
						<Hint label="Attach to message">
							<Button
								variant="text"
								size="icon"
								aria-label="Attach to message"
								onClick={() =>
									sendReference(threadId, {
										kind: "file",
										id: editorPath,
										label: path.split("/").pop() ?? path,
									})
										? toast({ title: "Attached to your message" })
										: toast({ title: "Open the composer to attach" })
								}
								data-testid="file-view-attach"
							>
								<Paperclip className="size-3.5" />
							</Button>
						</Hint>
						{contents && chrome}
					</div>
					{now.isLoading || file.isLoading ? (
						<div className="px-3 pt-3">
							<Loading rows={6} />
						</div>
					) : file.data?.state === "unavailable" ? (
						<Empty
							className="px-3"
							text={UNAVAILABLE[file.data.reason]}
							testId="file-view-unavailable"
						/>
					) : !items.length ? (
						<Empty
							className="px-3"
							text="Worktree not available"
							testId="file-view-unavailable"
						/>
					) : (
						<WorkerPoolContextProvider {...POOL}>
							<section
								// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to scroll by keyboard.
								tabIndex={0}
								aria-label={`${path} as it is now`}
								className="flex min-h-0 flex-1 flex-col outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
								style={CODE_STYLE}
								data-testid="file-view-code"
							>
								<CodeView
									ref={view}
									items={items}
									className="min-h-0 flex-1 overflow-auto"
									selectedLines={range ? { id: path, range } : null}
									options={{
										overflow: "wrap",
										themeType: theme === "dark" ? "dark" : "light",
										disableFileHeader: true,
										preferredHighlighter: "shiki-js",
									}}
								/>
							</section>
						</WorkerPoolContextProvider>
					)}
				</>
			)}
		</Block>
	);
}
