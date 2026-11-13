// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IndexEntry,
	parseEventKey,
	type RailMark,
} from "@prismalens/contracts";
import { fromMarkdown } from "mdast-util-from-markdown";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { Rail, type RailBreak, type RailItem } from "@/components/kit/Rail";
import { formatClock, formatDayClock } from "@/lib/format-time";

/** A mark's name, e.g. "Usage limit, resets 18:30". */
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

/** The marks that break a thread, each a dash of its own; reports, children and PRs are not breaks. */
const BREAK_OF: Partial<Record<RailMark, RailBreak>> = {
	usage_limit: "limit",
	rate_limit: "limit",
	auth: "failure",
	blocked: "failure",
	error: "failure",
	restart: "restart",
	compaction: "compaction",
};

interface MdNode {
	type: string;
	value?: string;
	alt?: string | null;
	children?: MdNode[];
}
const INLINE = new Set([
	"emphasis",
	"strong",
	"delete",
	"link",
	"linkReference",
]);

function mdText(n: MdNode): string {
	if (n.type === "code" || n.type === "html") return " ";
	if (n.type === "image") return n.alt ?? "";
	if (typeof n.value === "string") return n.value;
	return (n.children ?? []).map(mdText).join(INLINE.has(n.type) ? "" : " ");
}

/**
 * A message start as one line of the text it renders: no markup, code or JSON.
 * The index cuts previews mid-markup, so an unclosed fence or marker is dropped too.
 */
export function plainText(markdown: string): string {
	const cut = markdown.replace(/```[\s\S]*?(?:```|$)/g, " ");
	const text = mdText(fromMarkdown(cut) as MdNode)
		.replace(/[*_~`]{2,}/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return /^[{[]\s*["{[]/.test(text) ? "" : text;
}

/**
 * The rail's dashes from the light index: one per turn (your message, or one
 * from another thread, with the agent's last words as its excerpt) and one per
 * break between them; a run of the same break, like retries, is one dash.
 */
export function railItems(
	entries: readonly IndexEntry[],
	working = false,
	now = Date.now(),
): RailItem[] {
	const items: RailItem[] = [];
	// The break that ended a turn before the agent said anything.
	const stops = new Map<RailItem, RailBreak>();
	let turn: RailItem | null = null;
	for (const [key, author, mark, text, at, detail] of entries) {
		const brk = mark ? BREAK_OF[mark] : undefined;
		if (!mark && (author === "you" || author === "thread")) {
			turn = { id: key, kind: "turn", title: plainText(text) };
			items.push(turn);
		} else if (!mark && author === "agent") {
			if (!turn) {
				turn = { id: key, kind: "turn", title: "Agent started" };
				items.push(turn);
			}
			// The excerpt is the turn's last agent message, the one that answers.
			turn.body = plainText(text) || turn.body;
		} else if (mark && brk) {
			if (turn && !turn.body) stops.set(turn, brk);
			if (items[items.length - 1]?.kind === brk) continue;
			const name = markLabel(mark, detail);
			const why = text.trim();
			items.push({
				id: key,
				kind: brk,
				title: name,
				body: [
					formatDayClock(at, now),
					why.toLowerCase() !== name.toLowerCase() ? why : "",
				]
					.filter(Boolean)
					.join(" · "),
			});
		}
	}
	for (const it of items) {
		if (it.kind !== "turn" || it.body) continue;
		const stop = stops.get(it);
		it.state =
			it === turn && working && !stop
				? "working"
				: stop === "failure"
					? "failed"
					: stop === "limit"
						? "limited"
						: "silent";
	}
	return items;
}

/** The last item at or before a key, so a tool event on screen still marks its turn. */
function useItemAt(items: readonly RailItem[]) {
	return useMemo(() => {
		const seqs = items.map((i) => parseEventKey(i.id)?.seq ?? 0);
		return (key: string | null) => {
			const seq = key ? parseEventKey(key)?.seq : undefined;
			if (seq === undefined) return undefined;
			let lo = 0;
			let hi = seqs.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (seqs[mid] <= seq) lo = mid + 1;
				else hi = mid;
			}
			return items[Math.max(lo - 1, 0)]?.id;
		};
	}, [items]);
}

/** The rail draws once the transcript scrolls; on a thread that fits one screen it would be noise. */
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

export interface RailProps {
	entries: readonly IndexEntry[];
	/** The first and last event keys on screen. */
	range: { first: string | null; last: string | null };
	/** Events with a find hit, and the active one; empty while find is closed. */
	hits: readonly string[];
	activeHit: string | null;
	onJump: (key: string) => void;
	/** The agent is on its turn, so the last turn's card says Working. */
	working?: boolean;
	/** The box holding the transcript scroller; absent, the rail always draws. */
	box?: RefObject<HTMLElement | null>;
}

/**
 * The thread's rail beside the transcript column, from the light index, so a
 * dash can point where no page is loaded. Hidden below `sm`: a phone has no
 * gutter beside the text and no hover; find and scrolling cover it there.
 */
export function TranscriptRail({
	entries,
	range,
	hits,
	activeHit,
	onJump,
	working = false,
	box,
}: RailProps) {
	const scrolls = useScrolls(box);
	const items = useMemo(() => railItems(entries, working), [entries, working]);
	const itemAt = useItemAt(items);
	const hitItems = useMemo(
		() => hits.map((h) => itemAt(h)).filter((h): h is string => !!h),
		[hits, itemAt],
	);
	if (items.length < 2 || !scrolls) return null;
	return (
		<nav
			aria-label="Thread outline"
			className="absolute top-1/2 left-[max(0px,calc(50%-412px))] z-10 hidden -translate-y-1/2 sm:block"
			data-testid="transcript-rail"
		>
			<Rail
				items={items}
				current={itemAt(activeHit ?? range.first)}
				hits={hitItems}
				onJump={onJump}
			/>
		</nav>
	);
}
