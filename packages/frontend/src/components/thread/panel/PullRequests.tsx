// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckRun,
	PrChecks,
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
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { prToneClass } from "@/lib/pr-tone";
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

const REVIEW_WORD: Partial<Record<PrReview, string>> = {
	approved: "Approved",
	changes_requested: "Changes requested",
	review_required: "Review required",
};

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

/** A PR watch, as Surface F adds it to each PR; absent until that contract lands. */
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

const RUN_TONE: Record<PrCheckRun["state"], PrTone> = {
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

export type PullRequestView = PullRequest & { watch?: PrWatch };

/** One PR: `#123 title`, its tone mark and word, then checks, review, conflicts and watch. */
export function PullRequestRow({
	pr,
	focused,
	onWatch,
}: {
	pr: PullRequestView;
	focused?: boolean;
	/** Surface F's watch routes; absent hides the control. */
	onWatch?: (pr: PullRequestView, on: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const Icon = TONE_ICON[pr.tone];
	const checks = checksLine(pr.checks);
	const runs = pr.checkRuns ?? [];
	const review = REVIEW_WORD[pr.review];
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
				{checks &&
					(runs.length ? (
						<button
							type="button"
							aria-expanded={open}
							onClick={() => setOpen((o) => !o)}
							className="flex items-center gap-1 text-left hover:text-text-1"
							data-testid="pr-checks"
						>
							<ChevronRight
								className={cn(
									"size-3 transition-transform duration-(--dur-instant)",
									open && "rotate-90",
								)}
								aria-hidden
							/>
							{checks}
						</button>
					) : (
						<span data-testid="pr-checks">{checks}</span>
					))}
				{open && runs.length > 0 && (
					<ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-4">
						{runs.map((r) => (
							<li
								key={`${r.appName ?? ""}:${r.name}`}
								className="flex min-w-0 items-center gap-1.5"
								data-testid="pr-check-run"
							>
								{r.appAvatarUrl && (
									<img
										src={r.appAvatarUrl}
										alt=""
										className="size-3.5 shrink-0 rounded-[3px]"
									/>
								)}
								<span className="min-w-0 flex-1 truncate">{r.name}</span>
								<span className={prToneClass(RUN_TONE[r.state])}>
									{RUN_WORD[r.state]}
								</span>
							</li>
						))}
					</ul>
				)}
				{review && <span data-testid="pr-review">{review}</span>}
				{pr.conflicts === true && (
					<span className="text-warn" data-testid="pr-conflicts">
						Merge conflict
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
			</div>
		</li>
	);
}

export function PullRequestList({
	prs,
	focusId,
	onWatch,
}: {
	prs: PullRequestView[];
	focusId?: string;
	onWatch?: (pr: PullRequestView, on: boolean) => void;
}) {
	return (
		<ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="pr-list">
			{prs.map((pr) => (
				<PullRequestRow
					key={pr.id}
					pr={pr}
					focused={pr.id === focusId}
					onWatch={onWatch}
				/>
			))}
		</ul>
	);
}
