// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IndexAuthor,
	type IndexEntry,
	parseEventKey,
	type RailMark,
} from "@prismalens/contracts";
import { useMemo } from "react";
import { Rail, type RailItem } from "@/components/kit/Rail";
import { formatClock } from "@/lib/format-time";

const AUTHOR_WORD: Record<IndexAuthor, string> = {
	you: "You",
	agent: "Agent",
	thread: "Another thread",
	system: "PrismaLens",
};

/** A mark's hover name, e.g. "Usage limit, resets 18:30". */
export function markLabel(mark: RailMark, detail: string | null): string {
	switch (mark) {
		case "compaction":
			return "Context compacted";
		case "usage_limit":
			return detail
				? `Usage limit, resets ${formatClock(detail)}`
				: "Usage limit";
		case "rate_limit":
			return detail === "overloaded" ? "Provider overloaded" : "Rate limited";
		case "auth":
			return "API key rejected";
		case "blocked":
			return detail === "spend_cap" ? "Spend cap reached" : "Out of credit";
		case "restart":
			return "Interrupted by restart";
		case "error":
			return "Error";
		case "report":
			return "Report";
		case "child":
			return detail ? `Child thread ${detail}` : "Child thread finished";
		case "pr":
			return "Pull request linked";
	}
}

/** Kit marks: limits, failures and restarts in a status colour, compaction grey (sheet §2). */
const KIT_MARK: Partial<Record<RailMark, RailItem["mark"]>> = {
	usage_limit: "limit",
	rate_limit: "limit",
	auth: "failure",
	blocked: "failure",
	error: "failure",
	restart: "restart",
	compaction: "compaction",
};

/** One line for the hover: the mark's name, then its text unless that repeats the name. */
export function railPreview(e: IndexEntry): string {
	const text = e[3]?.trim() ?? "";
	if (!e[2]) return text ? `${AUTHOR_WORD[e[1]]}: ${text}` : AUTHOR_WORD[e[1]];
	const name = markLabel(e[2], e[5]);
	return text && text.toLowerCase() !== name.toLowerCase()
		? `${name}: ${text}`
		: name;
}

export interface RailProps {
	entries: readonly IndexEntry[];
	/** The first and last event keys on screen. */
	range: { first: string | null; last: string | null };
	/** Items with a find hit, and the active one. */
	hits: readonly string[];
	activeHit: string | null;
	onJump: (key: string) => void;
}

/** Where a key sits between the record's first and last seq, 0..1. */
function useSpan(entries: readonly IndexEntry[]) {
	return useMemo(() => {
		const seqs = entries.map((e) => parseEventKey(e[0])?.seq ?? 0);
		const lo = Math.min(...seqs, 0);
		const hi = Math.max(...seqs, lo + 1);
		return (key: string | null) => {
			const seq = key ? parseEventKey(key)?.seq : undefined;
			return seq === undefined ? null : (seq - lo) / (hi - lo);
		};
	}, [entries]);
}

/**
 * The thread's rail on the left edge of the transcript column, from the light
 * index, so a line can point where no page is loaded. The kit Rail draws it;
 * the current line is the active find hit while find is open.
 */
export function TranscriptRail({
	entries,
	range,
	hits,
	activeHit,
	onJump,
}: RailProps) {
	const at = useSpan(entries);
	const items = useMemo(
		() =>
			entries.flatMap((e): RailItem[] => {
				const y = at(e[0]);
				if (y === null) return [];
				return [
					{
						id: e[0],
						at: y,
						author: e[1] === "you" || e[1] === "agent" ? e[1] : "thread",
						mark: e[2] ? KIT_MARK[e[2]] : undefined,
						preview: railPreview(e),
					},
				];
			}),
		[entries, at],
	);
	if (items.length < 2) return null;
	const current = activeHit ?? range.first ?? undefined;
	return (
		<nav
			aria-label="Thread outline"
			className="absolute top-3 bottom-16 left-[max(0px,calc(50%-412px))] z-10 hidden sm:block"
			data-testid="transcript-rail"
		>
			<Rail items={items} current={current} hits={[...hits]} onJump={onJump} />
		</nav>
	);
}
