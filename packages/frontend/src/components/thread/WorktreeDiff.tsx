// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
	WORKTREE_MAX_FILES,
	type WorktreeChanges,
	type WorktreeRepoChanges,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CODE_STYLE, POOL } from "@/components/run/EvidenceFileView";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { orpc } from "@/lib/api/orpc-client";
import { useTheme } from "@/lib/providers/theme-provider";
import { changeNote, splitPatch } from "@/lib/run-panel";
import { cn } from "@/lib/utils";

const UNAVAILABLE: Record<
	Extract<WorktreeRepoChanges, { state: "unavailable" }>["reason"],
	string
> = {
	removed: "Workspace removed",
	"not-a-workspace": "Workspace not found",
	"commit-gone": "Start commit gone",
};

const STATUS_WORD = {
	added: "new",
	deleted: "deleted",
	submodule: "submodule",
	link: "link",
	modified: "",
} as const;

/** The run's live changes, polled while it works; one query feeds the tab and the status box. */
export function useWorktreeChanges(runId: string, live: boolean) {
	return useQuery({
		...orpc.investigations.getChanges.queryOptions({ input: { id: runId } }),
		refetchInterval: live ? 5000 : false,
		retry: false,
	});
}

/** `+77 −3` across every repo that answered; null until one did. */
export function changeTotals(
	data: WorktreeChanges | undefined,
): { additions: number; deletions: number } | null {
	const ok = data?.repos.filter((r) => r.state === "ok") ?? [];
	if (ok.length === 0) return null;
	return {
		additions: ok.reduce((n, r) => n + (r.state === "ok" ? r.additions : 0), 0),
		deletions: ok.reduce((n, r) => n + (r.state === "ok" ? r.deletions : 0), 0),
	};
}

/**
 * The Diff tab (#1020): the run's workspace against the commit it started at, a file
 * list and one file's patch at a time. Untracked files count as new; links and nested
 * repositories are listed, never opened.
 */
export function WorktreeDiff({
	runId,
	live,
}: {
	runId: string;
	live: boolean;
}) {
	const query = useWorktreeChanges(runId, live);
	const [repoAt, setRepoAt] = useState(0);
	if (query.isLoading)
		return (
			<div className="px-3 pt-3">
				<Loading rows={4} />
			</div>
		);
	if (query.error || !query.data)
		return (
			<Problem
				className="px-3"
				text="Changes did not load"
				onRetry={() => void query.refetch()}
			/>
		);
	const repos = query.data.repos;
	if (repos.length === 0)
		return <Empty className="px-3" text="No code here" testId="diff-none" />;
	const repo = repos[repoAt] ?? repos[0];
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="worktree-diff">
			{repos.length > 1 && (
				<fieldset
					aria-label="Repository"
					className="m-0 flex shrink-0 flex-wrap gap-1 border-0 px-3 pt-2.5"
				>
					{repos.map((r, i) => (
						<button
							key={r.repo}
							type="button"
							aria-pressed={i === repoAt}
							onClick={() => setRepoAt(i)}
							className={cn(
								"h-6 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
								i === repoAt
									? "bg-surface-3 text-text-1"
									: "text-text-2 hover:text-text-1",
							)}
						>
							{r.repo}
						</button>
					))}
				</fieldset>
			)}
			{repo && <RepoDiff key={repo.repo} repo={repo} />}
		</div>
	);
}

function RepoDiff({ repo }: { repo: WorktreeRepoChanges }) {
	const { theme } = useTheme();
	const [file, setFile] = useState<string | null>(null);
	const patches = useMemo(
		() => (repo.state === "ok" && repo.patch ? splitPatch(repo.patch) : []),
		[repo],
	);
	if (repo.state === "unavailable")
		return (
			<Empty
				className="px-3"
				text={UNAVAILABLE[repo.reason]}
				testId="diff-unavailable"
			/>
		);
	if (repo.files.length === 0)
		return <Empty className="px-3" text="No changes yet" testId="diff-empty" />;
	const shown =
		(file && repo.files.some((f) => f.path === file) ? file : null) ??
		repo.files[0]?.path ??
		null;
	const patch = patches.find((p) => p.path === shown);
	const note = patch ? changeNote(patch.text) : null;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ul
				aria-label="Changed files"
				className="m-0 max-h-48 shrink-0 list-none overflow-y-auto px-2 py-2"
				data-testid="diff-files"
			>
				{repo.files.map((f) => (
					<li key={f.path}>
						<button
							type="button"
							aria-current={f.path === shown ? "true" : undefined}
							onClick={() => setFile(f.path)}
							className={cn(
								"flex w-full items-baseline gap-2 rounded-control px-2 py-1 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3",
								f.path === shown && "bg-surface-3",
							)}
							data-testid="diff-file"
							data-status={f.status}
						>
							<span className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
								{f.path}
							</span>
							{STATUS_WORD[f.status] && (
								<span className="shrink-0 text-meta text-text-3">
									{STATUS_WORD[f.status]}
								</span>
							)}
							{f.additions !== null && (
								<span className="shrink-0 text-meta tabular-nums">
									<span className="text-ok">+{f.additions}</span>{" "}
									<span className="text-danger">−{f.deletions ?? 0}</span>
								</span>
							)}
						</button>
					</li>
				))}
			</ul>
			{repo.truncated && (
				<p className="px-3 text-meta text-text-3" data-testid="diff-truncated">
					Only the first {WORKTREE_MAX_FILES} new files are listed; the totals
					cover those.
				</p>
			)}
			{repo.omitted === "too-large" ? (
				<Empty
					className="px-3"
					text="Too large to show"
					testId="diff-too-large"
				/>
			) : patch && note ? (
				<p className="px-3 text-text-2">{note}</p>
			) : patch ? (
				<WorkerPoolContextProvider {...POOL}>
					<section
						// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to scroll by keyboard.
						tabIndex={0}
						aria-label={`Changes to ${patch.path}, read-only`}
						className="min-h-0 flex-1 overflow-auto shadow-[0_-1px_0_var(--hairline)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
						style={CODE_STYLE}
						data-testid="diff-patch"
					>
						<PatchDiff
							key={patch.path}
							patch={patch.text}
							options={{
								diffStyle: "unified",
								overflow: "wrap",
								themeType: theme === "dark" ? "dark" : "light",
								disableFileHeader: true,
							}}
						/>
					</section>
				</WorkerPoolContextProvider>
			) : repo.files.find((f) => f.path === shown)?.status === "link" ? (
				// A link or hard link on the path: neither git nor PrismaLens opens it (#1020).
				<Empty className="px-3" text="Linked file" testId="diff-linked-file" />
			) : repo.files.find((f) => f.path === shown)?.status === "added" ? (
				// New files are listed, never read, so they have no lines to show (#1020).
				<Empty className="px-3" text="New file" testId="diff-new-file" />
			) : (
				<Empty className="px-3" text="Nothing to show" testId="diff-no-patch" />
			)}
		</div>
	);
}
