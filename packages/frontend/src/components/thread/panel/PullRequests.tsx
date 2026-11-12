// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckLog,
	PrCheckRun,
	PrChecks,
	PrMergeState,
	PrReview,
	PrReviewThread,
	PrTone,
	PullRequest,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import {
	ChevronRight,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import { compose } from "@/lib/compose";
import { prToneClass } from "@/lib/pr-tone";
import { cn } from "@/lib/utils";
import { checkFixMessage, reviewFixMessage } from "./pr-fix";

/** The word beside every tone mark: colour never speaks alone. */
export const PR_TONE_WORD: Record<PrTone, string> = {
	ready: "Ready",
	open: "Open",
	draft: "Draft",
	attention: "Needs attention",
	failing: "Failing",
	merged: "Merged",
	closed: "Closed",
	unknown: "Unknown",
};

const TONE_ICON: Record<PrTone, LucideIcon> = {
	ready: GitPullRequest,
	open: GitPullRequest,
	draft: GitPullRequestDraft,
	attention: GitPullRequest,
	failing: GitPullRequest,
	merged: GitMerge,
	closed: GitPullRequestClosed,
	unknown: GitPullRequest,
};

const REVIEW_WORD: Partial<Record<PrReview, string>> = {
	approved: "Approved",
	changes_requested: "Changes requested",
	review_required: "Review required",
};

/** The merge state's word and tone; `unknown` says nothing. */
export const MERGE_WORD: Record<PrMergeState, [string, PrTone] | null> = {
	clean: ["Can merge", "ready"],
	blocked: ["Merge blocked", "attention"],
	behind: ["Behind base", "attention"],
	conflicts: ["Merge conflict", "attention"],
	unstable: ["Merge waits on checks", "attention"],
	draft: null,
	unknown: null,
};

/** `7/9 checks`: passing of all; null when the host reports no checks. */
export function checksCount(c: PrChecks): string | null {
	if (c.state === "none" || c.state === "unknown" || c.total === 0) return null;
	return `${c.total - c.failed - c.pending}/${c.total} checks`;
}

/** `2 failing · 1 running of 9`; null when the host reports no checks. */
export function checksLine(c: PrChecks): string | null {
	if (c.state === "none" || c.state === "unknown" || c.total === 0) return null;
	const parts = [
		...(c.failed ? [`${c.failed} failing`] : []),
		...(c.pending ? [`${c.pending} running`] : []),
	];
	return parts.length
		? `${parts.join(" · ")} of ${c.total}`
		: `${c.total} passing`;
}

/** A PR's watch as the panel reads it: the contract's `PrWatch` fits, and a partial one renders too. */
export interface PrWatch {
	state: "watching" | "waiting" | "disconnected" | "expired" | "stopped";
	reason?: string | null;
	since?: string | null;
	until?: string | null;
}

/** The watch's one quiet line. */
export function watchLine(w: PrWatch): string {
	switch (w.state) {
		case "watching":
			return "Watching checks and reviews";
		case "waiting":
			return "Update waiting for the agent";
		case "disconnected":
			return "Host unreachable, retrying";
		case "expired":
			return w.reason ? `Stopped watching: ${w.reason}` : "Stopped watching";
		case "stopped":
			return w.reason ? `Stopped: ${w.reason}` : "Stopped";
	}
}

const watching = (w: PrWatch) =>
	w.state === "watching" || w.state === "waiting" || w.state === "disconnected";

export const RUN_TONE: Record<PrCheckRun["state"], PrTone> = {
	passing: "ready",
	failing: "failing",
	pending: "attention",
	neutral: "unknown",
};
const RUN_WORD: Record<PrCheckRun["state"], string> = {
	passing: "Passing",
	failing: "Failing",
	pending: "Running",
	neutral: "Neutral",
};
const RUN_ORDER: Record<PrCheckRun["state"], number> = {
	failing: 0,
	pending: 1,
	neutral: 2,
	passing: 3,
};

/** Failing first, then running, neutral and passing; the host's order within each. */
export function sortedRuns(runs: PrCheckRun[]): PrCheckRun[] {
	return runs
		.map((r, i) => [r, i] as const)
		.sort(([a, i], [b, j]) => RUN_ORDER[a.state] - RUN_ORDER[b.state] || i - j)
		.map(([r]) => r);
}

/** What the PR answers, from the thread's incident and report (#1101 category 15 item 6). */
export interface PrAnswers {
	incidentNumber?: number | null;
	cause?: string | null;
}

export type PullRequestView = Omit<PullRequest, "watch"> & { watch?: PrWatch };

/** Where the row sends its actions; each absent hides its control. */
export interface PrRowActions {
	/** The thread whose PR this is: reads a check's log tail when it is not kept yet. */
	threadId?: string;
	/** Surface F's watch routes. */
	onWatch?: (pr: PullRequestView, on: boolean) => void;
	/** Opens a review thread's file at its line in the thread's diff. */
	onOpenFile?: (pr: PullRequestView, path: string, line: number | null) => void;
	/** Drafts a message in the composer; defaults to the composer's own seam. */
	onDraft?: (text: string) => void;
}

/**
 * One PR (#1101 category 15): `#123 title` and tone, the branch pair, `N/M checks`,
 * review and merge state; checks and review threads open in place.
 */
export function PullRequestRow({
	pr,
	focused,
	answers,
	...actions
}: {
	pr: PullRequestView;
	focused?: boolean;
	answers?: PrAnswers | null;
} & PrRowActions) {
	const runs = sortedRuns(pr.checkRuns ?? []);
	const [open, setOpen] = useState(
		() => !!focused && runs.some((r) => r.state !== "passing"),
	);
	const Icon = TONE_ICON[pr.tone];
	const count = checksCount(pr.checks);
	const detail = checksLine(pr.checks);
	const review = REVIEW_WORD[pr.review];
	const merge =
		pr.state === "open" ? MERGE_WORD[pr.mergeState ?? "unknown"] : null;
	const showConflict = pr.conflicts === true && pr.mergeState !== "conflicts";
	const { onWatch } = actions;
	return (
		<li
			className={cn(
				"flex flex-col gap-1 rounded-surface px-2 py-1.5",
				focused && "bg-surface-3",
			)}
			data-testid="pr-row"
			data-tone={pr.tone}
		>
			<div className="flex min-w-0 items-baseline gap-2">
				<Icon
					className={cn("size-3.5 shrink-0 self-center", prToneClass(pr.tone))}
					aria-hidden
				/>
				<a
					href={pr.url}
					target="_blank"
					rel="noreferrer"
					className="min-w-0 flex-1 truncate text-text-1 hover:underline"
				>
					<span className="text-text-3 tabular-nums">#{pr.number}</span>{" "}
					{pr.title ?? pr.repo}
				</a>
				<span
					className={cn("shrink-0 text-meta", prToneClass(pr.tone))}
					data-testid="pr-tone-word"
				>
					{PR_TONE_WORD[pr.tone]}
				</span>
			</div>
			<div className="flex flex-col gap-0.5 pl-5.5 text-meta text-text-2">
				{pr.headRef && (
					<span
						className="min-w-0 truncate font-mono text-text-3"
						data-testid="pr-branches"
					>
						{pr.headRef}
						{pr.baseRef && (
							<>
								<span className="font-sans"> into </span>
								{pr.baseRef}
							</>
						)}
					</span>
				)}
				<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
					{count &&
						(runs.length ? (
							<button
								type="button"
								aria-expanded={open}
								onClick={() => setOpen((o) => !o)}
								className="-ml-1 flex min-h-6 items-center gap-1 rounded-control px-1 text-left hover:bg-surface-3 hover:text-text-1"
								data-testid="pr-checks"
							>
								<ChevronRight
									className={cn(
										"size-3 transition-transform duration-(--dur-instant)",
										open && "rotate-90",
									)}
									aria-hidden
								/>
								<span className="tabular-nums">{count}</span>
								{pr.checks.failed + pr.checks.pending > 0 && (
									<span className={prToneClass(pr.tone)}>
										{detail?.replace(/ of \d+$/, "")}
									</span>
								)}
							</button>
						) : (
							<span data-testid="pr-checks" className="tabular-nums">
								{count}
							</span>
						))}
					{review && <span data-testid="pr-review">{review}</span>}
					{merge && (
						<span className={prToneClass(merge[1])} data-testid="pr-merge">
							{merge[0]}
						</span>
					)}
					{showConflict && (
						<span className="text-warn" data-testid="pr-conflicts">
							Merge conflict
						</span>
					)}
				</span>
				{open && runs.length > 0 && (
					<ul
						className="m-0 flex list-none flex-col gap-0.5 p-0 pl-4"
						data-testid="pr-check-runs"
					>
						{runs.map((r) => (
							<CheckRunRow
								key={`${r.appName ?? ""}:${r.name}:${r.id ?? ""}`}
								pr={pr}
								run={r}
								{...actions}
							/>
						))}
					</ul>
				)}
				{(pr.reviewThreads?.length || pr.reviewThreadsNote) && (
					<ReviewThreads pr={pr} {...actions} />
				)}
				{answers && (answers.incidentNumber || answers.cause) && (
					<span className="min-w-0 truncate" data-testid="pr-answers">
						{answers.incidentNumber
							? `Answers incident #${answers.incidentNumber}`
							: "Answers this thread's report"}
						{answers.cause && (
							<span className="text-text-3">: {answers.cause}</span>
						)}
					</span>
				)}
				{pr.watch && (
					<span className="flex items-center gap-2" data-testid="pr-watch">
						<span className="min-w-0 flex-1 truncate text-text-3">
							{watchLine(pr.watch)}
						</span>
						{onWatch && (
							<Button
								variant="text"
								size="sm"
								onClick={() => onWatch(pr, !watching(pr.watch as PrWatch))}
							>
								{watching(pr.watch) ? "Stop watching" : "Watch"}
							</Button>
						)}
					</span>
				)}
				{!pr.watch &&
					onWatch &&
					pr.state !== "merged" &&
					pr.state !== "closed" && (
						<span className="flex items-center gap-2" data-testid="pr-watch">
							<span className="min-w-0 flex-1 truncate text-text-3">
								Not watched
							</span>
							<Button
								variant="text"
								size="sm"
								onClick={() => onWatch(pr, true)}
							>
								Watch
							</Button>
						</span>
					)}
			</div>
		</li>
	);
}

function CheckRunRow({
	pr,
	run,
	threadId,
	onDraft = compose,
}: { pr: PullRequestView; run: PrCheckRun } & PrRowActions) {
	const failing = run.state === "failing";
	return (
		<li
			className="flex flex-col gap-1"
			data-testid="pr-check-run"
			data-state={run.state}
		>
			<span className="flex min-w-0 items-center gap-1.5">
				{run.appAvatarUrl && (
					<img
						src={run.appAvatarUrl}
						alt=""
						className="size-3.5 shrink-0 rounded-[3px]"
					/>
				)}
				<span className="min-w-0 flex-1 truncate">{run.name}</span>
				<span className={prToneClass(RUN_TONE[run.state])}>
					{RUN_WORD[run.state]}
				</span>
				{run.url && (
					<a
						href={run.url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex min-h-6 items-center text-accent hover:underline"
						aria-label={`Log of ${run.name}`}
						data-testid="pr-check-log-link"
					>
						Log
					</a>
				)}
			</span>
			{failing && (
				<CheckLogTail pr={pr} run={run} threadId={threadId} onDraft={onDraft} />
			)}
		</li>
	);
}

/** A failing check's step and last lines, read once and kept per head commit. */
function CheckLogTail({
	pr,
	run,
	threadId,
	onDraft,
}: {
	pr: PullRequestView;
	run: PrCheckRun;
	threadId?: string;
	onDraft: (text: string) => void;
}) {
	const kept = pr.checkLogs?.find(
		(l) =>
			l.runId === run.id && l.headSha === (run.headSha ?? pr.headSha ?? null),
	);
	const query = useQuery({
		...orpc.threads.prCheckLog.queryOptions({
			input: { id: threadId ?? "", prId: pr.id, runId: run.id ?? "" },
		}),
		enabled: !kept && !!threadId && !!run.id,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const log: PrCheckLog | undefined = kept ?? query.data;
	return (
		<div className="flex flex-col gap-1 pb-1 pl-5" data-testid="pr-check-tail">
			{query.isLoading && !kept ? (
				<span className="flex items-center gap-1.5 text-text-3">
					<Ring className="size-3" />
					Reading the log
				</span>
			) : !run.id ? (
				<span className="text-text-3">No log for this check</span>
			) : query.error && !log ? (
				<span className="text-text-3">Log unavailable, the host refused</span>
			) : log?.unavailable ? (
				<span className="text-text-3" data-testid="pr-check-unavailable">
					{log.unavailable}
				</span>
			) : (
				log && (
					<>
						{log.step && (
							<span>
								Failed at <span className="text-text-1">{log.step}</span>
							</span>
						)}
						<pre
							className="m-0 max-h-48 overflow-auto rounded-control bg-surface-1 p-2 font-mono text-meta text-text-2"
							data-testid="pr-check-lines"
							data-scroll-x
						>
							{log.lines.join("\n")}
						</pre>
					</>
				)
			)}
			<span>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => onDraft(checkFixMessage(pr, run, log))}
					data-testid="pr-fix-check"
				>
					Ask the agent to fix
				</Button>
			</span>
		</div>
	);
}

/** Review threads, open first (#1101 category 15 item 4). */
function ReviewThreads({
	pr,
	onOpenFile,
	onDraft = compose,
}: { pr: PullRequestView } & PrRowActions) {
	const threads = [...(pr.reviewThreads ?? [])].sort(
		(a, b) => Number(a.resolved) - Number(b.resolved),
	);
	const unresolved = threads.filter((t) => !t.resolved).length;
	const [open, setOpen] = useState(unresolved > 0);
	return (
		<div className="flex flex-col gap-0.5" data-testid="pr-review-threads">
			{threads.length > 0 ? (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
					className="-ml-1 flex min-h-6 items-center gap-1 rounded-control px-1 text-left hover:bg-surface-3 hover:text-text-1"
					data-testid="pr-review-toggle"
				>
					<ChevronRight
						className={cn(
							"size-3 transition-transform duration-(--dur-instant)",
							open && "rotate-90",
						)}
						aria-hidden
					/>
					<span className="tabular-nums">
						{unresolved
							? `${unresolved} open review ${unresolved === 1 ? "thread" : "threads"}`
							: `${threads.length} resolved review ${threads.length === 1 ? "thread" : "threads"}`}
					</span>
				</button>
			) : null}
			{pr.reviewThreadsNote && (
				<span className="text-text-3" data-testid="pr-review-note">
					{pr.reviewThreadsNote}
				</span>
			)}
			{open && (
				<ul className="m-0 flex list-none flex-col gap-1.5 p-0 pl-4">
					{threads.map((t) => (
						<ReviewThreadRow
							key={t.id}
							pr={pr}
							thread={t}
							onOpenFile={onOpenFile}
							onDraft={onDraft}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function ReviewThreadRow({
	pr,
	thread: t,
	onOpenFile,
	onDraft,
}: {
	pr: PullRequestView;
	thread: PrReviewThread;
	onOpenFile?: PrRowActions["onOpenFile"];
	onDraft: (text: string) => void;
}) {
	const where = t.line ? `${t.path}:${t.line}` : t.path;
	return (
		<li
			className="flex flex-col gap-0.5"
			data-testid="pr-review-thread"
			data-resolved={t.resolved}
		>
			<span className="flex min-w-0 items-center gap-2">
				{onOpenFile ? (
					<button
						type="button"
						onClick={() => onOpenFile(pr, t.path, t.line)}
						className="min-h-6 min-w-0 truncate text-left font-mono text-accent hover:underline"
						title={`Open ${where} in the diff`}
						data-testid="pr-review-where"
					>
						{where}
					</button>
				) : (
					<span className="min-w-0 truncate font-mono">{where}</span>
				)}
				<span
					className={cn(
						"ml-auto shrink-0",
						t.resolved ? "text-text-3" : prToneClass("attention"),
					)}
				>
					{t.resolved ? "Resolved" : t.outdated ? "Open, outdated" : "Open"}
				</span>
			</span>
			<span className="text-text-3">
				{t.author}
				{t.replies > 0 &&
					` · ${t.replies} ${t.replies === 1 ? "reply" : "replies"}`}
			</span>
			<span className="line-clamp-2 whitespace-pre-line text-text-2">
				{t.excerpt}
			</span>
			{!t.resolved && (
				<span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => onDraft(reviewFixMessage(pr, t))}
						data-testid="pr-fix-review"
					>
						Ask the agent to fix
					</Button>
				</span>
			)}
		</li>
	);
}

export function PullRequestList({
	prs,
	focusId,
	answers,
	...actions
}: {
	prs: PullRequestView[];
	focusId?: string;
	answers?: PrAnswers | null;
} & PrRowActions) {
	return (
		<ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="pr-list">
			{prs.map((pr) => (
				<PullRequestRow
					key={pr.id}
					pr={pr}
					focused={pr.id === focusId}
					answers={answers}
					{...actions}
				/>
			))}
		</ul>
	);
}
