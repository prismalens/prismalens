// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckRun,
	PrChecks,
	PrMergeState,
	PrReview,
	PrTone,
	PullRequest,
} from "@prismalens/contracts";
import {
	ChevronRight,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

export const REVIEW_WORD: Partial<Record<PrReview, string>> = {
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

export const watching = (w: PrWatch) =>
	w.state === "watching" || w.state === "waiting" || w.state === "disconnected";

export const RUN_TONE: Record<PrCheckRun["state"], PrTone> = {
	passing: "ready",
	failing: "failing",
	pending: "attention",
	neutral: "unknown",
};
export const RUN_WORD: Record<PrCheckRun["state"], string> = {
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
 * Only the mark carries colour (sheet §9.1): failing is the error colour,
 * needs-attention the warning colour, every other state stays neutral.
 */
export function prMarkClass(tone: PrTone): string {
	if (tone === "failing") return "text-danger";
	if (tone === "attention") return "text-warn";
	return "text-text-3";
}

export const prIcon = (tone: PrTone): LucideIcon => TONE_ICON[tone];

/** `Failing 7/9`: the state word and the passing count, as one quiet phrase. */
export function prSummary(pr: Pick<PullRequest, "tone" | "checks">): string {
	const count = checksCount(pr.checks)?.replace(/ checks$/, "");
	return [PR_TONE_WORD[pr.tone], count].filter(Boolean).join(" ");
}

/**
 * One PR as one line (sheet §3): its mark, `#412` and title, `Failing 7/9`.
 * The line opens the PR view; nothing expands in place.
 */
export function PullRequestRow({
	pr,
	focused,
	onOpen,
}: {
	pr: PullRequestView;
	focused?: boolean;
	onOpen: (prId: string) => void;
}) {
	const Icon = TONE_ICON[pr.tone];
	return (
		<li data-testid="pr-row" data-tone={pr.tone}>
			<button
				type="button"
				onClick={() => onOpen(pr.id)}
				className={cn(
					"group/line flex h-7 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-body outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent max-md:h-auto max-md:min-h-11!",
					focused && "bg-surface-3",
				)}
				aria-label={`Pull request #${pr.number}, ${prSummary(pr)}. Open it`}
			>
				<Icon
					className={cn(
						"size-3.5 shrink-0 stroke-[1.75]",
						prMarkClass(pr.tone),
					)}
					aria-hidden
				/>
				<span className="shrink-0 text-text-1 tabular-nums">#{pr.number}</span>
				<span className="min-w-0 flex-1 truncate text-text-2">
					{pr.title ?? pr.repo}
				</span>
				<span
					className="shrink-0 text-meta text-text-3 tabular-nums"
					data-testid="pr-tone-word"
				>
					{prSummary(pr)}
				</span>
				<ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-3" />
			</button>
		</li>
	);
}

export function PullRequestList({
	prs,
	focusId,
	onOpen,
}: {
	prs: PullRequestView[];
	focusId?: string;
	onOpen: (prId: string) => void;
}) {
	return (
		<ul className="m-0 flex list-none flex-col p-0" data-testid="pr-list">
			{prs.map((pr) => (
				<PullRequestRow
					key={pr.id}
					pr={pr}
					focused={pr.id === focusId}
					onOpen={onOpen}
				/>
			))}
		</ul>
	);
}
