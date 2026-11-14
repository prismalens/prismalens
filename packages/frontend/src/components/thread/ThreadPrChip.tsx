// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type PullRequest, prHostTerms, prLabel } from "@prismalens/contracts";
import type { ReactElement } from "react";
import { Status } from "@/components/kit/Status";
import { Surface } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { compose } from "@/lib/compose";
import {
	checksParts,
	checksTitle,
	PR_STATUS,
	PR_TONE_WORD,
} from "./panel/PullRequests";
import type { PrCtx } from "./panel/pr.actions";
import { checksFixMessage } from "./panel/pr-fix";

/** The PR the header shows: the newest one still open, else the newest. */
export function headerPr<T extends Pick<PullRequest, "state">>(
	prs: T[],
): T | undefined {
	const open = prs.filter((p) => p.state === "open" || p.state === "draft");
	return open.at(-1) ?? prs.at(-1);
}

type ChipPr = Pick<PullRequest, "id" | "number" | "tone" | "checks"> &
	Partial<Pick<PullRequest, "host" | "url" | "repo" | "headSha">>;

const prCtx = (
	pr: ChipPr,
	onOpen: (prId: string) => void,
	onRefresh?: () => void,
): PrCtx => ({
	url: pr.url ?? "",
	openPanel: () => onOpen(pr.id),
	refresh: () => onRefresh?.(),
	draftFix: () => compose(checksFixMessage(pr)),
	facts: {
		is: {
			hasUrl: !!pr.url,
			refreshable: !!onRefresh,
			failing: pr.checks?.state === "failing",
		},
	},
});

/** Any place that shows the thread's PR (the chip, the details row) offers the same menu. */
export function PrSurface({
	pr,
	onOpen,
	onRefresh,
	children,
}: {
	pr: ChipPr;
	onOpen: (prId: string) => void;
	onRefresh?: () => void;
	children: ReactElement;
}) {
	return (
		<Surface id="pr.chip" ctx={prCtx(pr, onOpen, onRefresh)}>
			{children}
		</Surface>
	);
}

const PART_TONE = {
	danger: "text-danger",
	running: "text-text-2",
	ok: "text-text-2",
} as const;

/**
 * The thread's PR in its header (#1101 category 15 item 1): number and what is not
 * passing (`1 failing · 1 running`), every count in the hint. A click opens its checks.
 */
export function ThreadPrChip({
	pr,
	more,
	onOpen,
	onRefresh,
}: {
	pr: ChipPr;
	/** Other PRs the thread has; the panel lists them. */
	more: number;
	onOpen: (prId: string) => void;
	/** Reads the change request from the host again. */
	onRefresh?: () => void;
}) {
	const terms = prHostTerms(pr.host);
	const title = checksTitle(pr.checks, terms);
	const parts = checksParts(pr.checks);
	const word = PR_TONE_WORD[pr.tone];
	// "Failing" beside "1 failing" says it twice; the counts carry it.
	const quietWord = pr.tone === "failing" && !!parts;
	return (
		<PrSurface pr={pr} onOpen={onOpen} onRefresh={onRefresh}>
			<button
				type="button"
				onClick={() => onOpen(pr.id)}
				className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-control px-2 text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
				aria-label={`${prLabel(pr.host, pr.number)}, ${word}${title ? `, ${title}` : ""}. Open it`}
				data-testid="thread-pr-chip"
				data-tone={pr.tone}
			>
				<Status
					kind={PR_STATUS[pr.tone]}
					word={word}
					className={
						quietWord
							? "[&>span:last-child]:sr-only"
							: "max-sm:[&>span:last-child]:sr-only"
					}
				/>
				<span className="whitespace-nowrap tabular-nums text-text-1">
					{terms.numberPrefix}
					{pr.number}
				</span>
				{parts && (
					<Hint label={title ?? ""}>
						<span
							className="whitespace-nowrap tabular-nums max-md:hidden"
							data-testid="thread-pr-checks"
						>
							{parts.map((p, i) => (
								<span key={p.text}>
									{i > 0 && <span className="text-text-3"> · </span>}
									<span className={PART_TONE[p.tone]}>{p.text}</span>
								</span>
							))}
						</span>
					</Hint>
				)}
				{more > 0 && <span className="tabular-nums">+{more}</span>}
			</button>
		</PrSurface>
	);
}
