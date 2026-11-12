// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PullRequest } from "@prismalens/contracts";
import { GitPullRequest } from "lucide-react";
import { prToneClass } from "@/lib/pr-tone";
import { cn } from "@/lib/utils";
import { checksCount, PR_TONE_WORD } from "./panel/PullRequests";

/** The PR the header shows: the newest one still open, else the newest. */
export function headerPr<T extends Pick<PullRequest, "state">>(
	prs: T[],
): T | undefined {
	const open = prs.filter((p) => p.state === "open" || p.state === "draft");
	return open.at(-1) ?? prs.at(-1);
}

/**
 * The thread's PR in its header (#1101 category 15 item 1): number, tone word and
 * `N/M checks`. One click opens its panel row with the checks showing.
 */
export function ThreadPrChip({
	pr,
	more,
	onOpen,
}: {
	pr: Pick<PullRequest, "id" | "number" | "tone" | "checks">;
	/** Other PRs the thread has; the panel lists them. */
	more: number;
	onOpen: (prId: string) => void;
}) {
	const count = checksCount(pr.checks);
	const word = PR_TONE_WORD[pr.tone];
	return (
		<button
			type="button"
			onClick={() => onOpen(pr.id)}
			className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-control bg-surface-2 px-2 text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
			aria-label={`Pull request #${pr.number}, ${word}${count ? `, ${count}` : ""}. Open its checks`}
			data-testid="thread-pr-chip"
			data-tone={pr.tone}
		>
			<GitPullRequest
				className={cn("size-3.5 shrink-0", prToneClass(pr.tone))}
				aria-hidden
			/>
			<span className="tabular-nums text-text-1">#{pr.number}</span>
			<span className={cn("max-sm:hidden", prToneClass(pr.tone))}>{word}</span>
			{count && <span className="tabular-nums max-md:hidden">{count}</span>}
			{more > 0 && <span className="tabular-nums">+{more}</span>}
		</button>
	);
}
