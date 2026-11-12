// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IndexAuthor,
	type IndexEntry,
	parseEventKey,
	type RailMark,
} from "@prismalens/contracts";
import { type RefObject, useEffect, useMemo, useState } from "react";
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
	/** The box holding the transcript scroller; absent, the rail always draws. */
	box?: RefObject<HTMLElement | null>;
}

/** The last entry at or before a key, so a tool event on screen still marks its turn. */
function useEntryAt(entries: readonly IndexEntry[]) {
	return useMemo(() => {
		const seqs = entries.map((e) => parseEventKey(e[0])?.seq ?? 0);
		return (key: string | null) => {
			const seq = key ? parseEventKey(key)?.seq : undefined;
			if (seq === undefined) return undefined;
			let found: string | undefined;
			for (let i = 0; i < seqs.length && seqs[i] <= seq; i++)
				found = entries[i][0];
			return found ?? entries[0]?.[0];
		};
	}, [entries]);
}

/** The rail draws once the transcript scrolls; on a thread that fits one screen its few ticks read as stray dashes. */
export function railShown(scrollHeight: number, clientHeight: number): boolean {
	return clientHeight > 0 && scrollHeight > clientHeight + 1;
}

/** Whether the transcript's scroller (`data-testid="transcript-scroller"` under `box`) overflows. */
function useScrolls(box: RefObject<HTMLElement | null> | undefined): boolean {
	const [scrolls, setScrolls] = useState(!box);
	useEffect(() => {
		const el = box?.current?.querySelector<HTMLElement>(
			'[data-testid="transcript-scroller"]',
		);
		if (!el || typeof ResizeObserver === "undefined") return;
		const check = () => setScrolls(railShown(el.scrollHeight, el.clientHeight));
		check();
		const ro = new ResizeObserver(check);
		ro.observe(el);
		for (const child of Array.from(el.children)) ro.observe(child);
		return () => ro.disconnect();
	});
	return scrolls;
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
	box,
}: RailProps) {
	const entryAt = useEntryAt(entries);
	const scrolls = useScrolls(box);
	// The whole thread maps onto the strip by message order, not event seq: tool
	// runs between messages would otherwise leave gaps and bunch the rest.
	const items = useMemo(
		() =>
			entries.map(
				(e, i): RailItem => ({
					id: e[0],
					at: entries.length > 1 ? i / (entries.length - 1) : 0,
					author: e[1] === "you" || e[1] === "agent" ? e[1] : "thread",
					mark: e[2] ? KIT_MARK[e[2]] : undefined,
					preview: railPreview(e),
				}),
			),
		[entries],
	);
	if (items.length < 2 || !scrolls) return null;
	const current = activeHit ?? entryAt(range.first);
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
