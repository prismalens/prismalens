// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IndexEntry,
	parseEventKey,
	type RailMark,
} from "@prismalens/contracts";
import { fromMarkdown } from "mdast-util-from-markdown";
import { useMemo } from "react";
import { markLook } from "@/components/kit/marks";
import { Rail, type RailBreak, type RailItem } from "@/components/kit/Rail";
import { formatClock, formatDayClock } from "@/lib/format-time";
import { deliveredWords } from "@/lib/inbound-rows";

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
	const known = PLAIN.get(markdown);
	if (known !== undefined) return known;
	const cut = markdown.replace(/```[\s\S]*?(?:```|$)/g, " ");
	const text = mdText(fromMarkdown(cut) as MdNode)
		.replace(/[*_~`]{2,}/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const plain = /^[{[]\s*["{[]/.test(text) ? "" : text;
	if (PLAIN.size >= PLAIN_MAX)
		PLAIN.delete(PLAIN.keys().next().value as string);
	PLAIN.set(markdown, plain);
	return plain;
}

/** Parsed previews by their text: the rail redraws on every index change of a live run (#1181). */
const PLAIN = new Map<string, string>();
const PLAIN_MAX = 2_000;

/** A turn's first words; a delivered message names its sender, never the envelope the agent got. */
function turnTitle(text: string): string {
	const d = deliveredWords(text);
	const words = plainText(d.text);
	if (d.from === "thread") return `${d.name}: ${words}`;
	if (d.from === "wake") return `${markLook("inbound", "wake").word}: ${words}`;
	return words;
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
	// Each turn's agent messages and breaks, in order: only the ones that decide are parsed.
	const said = new Map<RailItem, string[]>();
	const breaks = new Map<RailItem, [RailBreak, number][]>();
	let turn: RailItem | null = null;
	for (const [key, author, mark, text, at, detail] of entries) {
		const brk = mark ? BREAK_OF[mark] : undefined;
		if (!mark && (author === "you" || author === "thread")) {
			turn = { id: key, kind: "turn", title: turnTitle(text) };
			items.push(turn);
		} else if (!mark && author === "agent") {
			if (!turn) {
				turn = { id: key, kind: "turn", title: "Agent started" };
				items.push(turn);
			}
			// The excerpt is the turn's last agent message, the one that answers.
			const list = said.get(turn);
			if (list) list.push(text);
			else said.set(turn, [text]);
		} else if (mark && brk) {
			if (turn) {
				const at: [RailBreak, number] = [brk, said.get(turn)?.length ?? 0];
				const list = breaks.get(turn);
				if (list) list.push(at);
				else breaks.set(turn, [at]);
			}
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
		const texts = said.get(it) ?? [];
		for (let i = texts.length - 1; i >= 0 && !it.body; i--)
			it.body = plainText(texts[i] as string) || undefined;
		// A break counts as the turn's stop while nothing the agent said before it had words.
		let first = 0;
		while (first < texts.length && !plainText(texts[first] as string)) first++;
		const stop = (breaks.get(it) ?? []).filter(([, n]) => n <= first).at(-1);
		if (stop) stops.set(it, stop[0]);
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
}

/**
 * The thread's rail at the pane's left edge, against the sidebar (#1101 bar 14.1), from
 * the light index, so a dash can point where no page is loaded. Hidden below `sm`: a
 * phone has no gutter and no hover; find and scrolling cover it there.
 */
export function TranscriptRail({
	entries,
	range,
	hits,
	activeHit,
	onJump,
	working = false,
}: RailProps) {
	const items = useMemo(() => railItems(entries, working), [entries, working]);
	const itemAt = useItemAt(items);
	const hitItems = useMemo(
		() => hits.map((h) => itemAt(h)).filter((h): h is string => !!h),
		[hits, itemAt],
	);
	// Every thread of two exchanges or more, scrolling or not: the page holds still (#1101).
	if (items.length < 2) return null;
	return (
		<nav
			aria-label="Thread outline"
			className="absolute top-1/2 left-1 z-10 hidden -translate-y-1/2 sm:block"
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
