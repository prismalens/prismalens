// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type PullRequest, prHostTerms, prLabel } from "@prismalens/contracts";
import { Status } from "@/components/kit";
import { Surface } from "@/components/kit/Surface";
import {
	checksCount,
	PR_STATUS,
	PR_TONE_WORD,
	passingOf,
} from "./panel/PullRequests";

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
	onRefresh,
}: {
	pr: Pick<PullRequest, "id" | "number" | "tone" | "checks"> &
		Partial<Pick<PullRequest, "host" | "url">>;
	/** Other PRs the thread has; the panel lists them. */
	more: number;
	onOpen: (prId: string) => void;
	/** Reads the change request from the host again. */
	onRefresh?: () => void;
}) {
	const terms = prHostTerms(pr.host);
	const count = checksCount(pr.checks, terms);
	const word = PR_TONE_WORD[pr.tone];
	return (
		<Surface
			id="pr.chip"
			ctx={{
				url: pr.url ?? "",
				openPanel: () => onOpen(pr.id),
				refresh: () => onRefresh?.(),
				facts: { is: { hasUrl: !!pr.url, refreshable: !!onRefresh } },
			}}
		>
			<button
				type="button"
				onClick={() => onOpen(pr.id)}
				className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-control px-2 text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
				aria-label={`${prLabel(pr.host, pr.number)}, ${word}${count ? `, ${count}` : ""}. Open it`}
				data-testid="thread-pr-chip"
				data-tone={pr.tone}
			>
				<Status
					kind={PR_STATUS[pr.tone]}
					word={word}
					className="max-sm:[&>span:last-child]:sr-only"
				/>
				<span className="whitespace-nowrap tabular-nums text-text-1">
					{terms.numberPrefix}
					{pr.number}
				</span>
				{passingOf(pr.checks) && (
					<span className="whitespace-nowrap tabular-nums max-md:hidden">
						{passingOf(pr.checks)}
					</span>
				)}
				{more > 0 && <span className="tabular-nums">+{more}</span>}
			</button>
		</Surface>
	);
}
