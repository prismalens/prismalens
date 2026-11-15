// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { compareKeys, findOccurrences } from "@prismalens/contracts";
import type { FindView } from "./find-highlight";

/** Paints the hits in the rows on screen; a failure clears them rather than break the page. */
export function paint(
	root: HTMLElement,
	registry: HighlightRegistry,
	find: FindView,
	ALL: string,
	ACTIVE: string,
): void {
	try {
		paintNow(root, registry, find, ALL, ACTIVE);
	} catch {
		registry.delete(ALL);
		registry.delete(ACTIVE);
	}
}

function paintNow(
	root: HTMLElement,
	registry: HighlightRegistry,
	find: FindView,
	ALL: string,
	ACTIVE: string,
): void {
	const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-at]"));
	const ats = rows.map((r) => r.dataset.at as string);
	// The key of the row that shows an event: the last row key at or before it.
	const rowKeyFor = (key: string) => {
		let found: string | null = null;
		for (const at of ats) if (compareKeys(at, key) <= 0) found = at;
		return found;
	};
	const hitAts = new Set<string>();
	for (const [key] of find.hits) {
		const at = rowKeyFor(key);
		if (at) hitAts.add(at);
	}
	const activeAt = find.current ? rowKeyFor(find.current.key) : null;
	const all = new Highlight();
	let activeRanges: Range[] = [];
	rows.forEach((row, i) => {
		const at = ats[i] as string;
		if (!hitAts.has(at)) return;
		const ranges = rangesIn(row, find.query, find.caseSensitive);
		for (const r of ranges) all.add(r);
		if (at === activeAt) activeRanges = activeRanges.concat(ranges);
	});
	registry.set(ALL, all);
	const n = Math.max(
		0,
		Math.min(find.current?.occurrence ?? 0, activeRanges.length - 1),
	);
	const hit = activeRanges[n];
	if (!hit) return;
	const bright = new Highlight(hit);
	bright.priority = 1;
	registry.set(ACTIVE, bright);
	revealOnce(root, hit, `${find.query}|${find.caseSensitive}|${activeAt}|${n}`);
}

let revealed = { id: "", seen: false, tries: 0 };

/**
 * Bring a new active hit on screen until it has been seen once: the row jump lands a tall
 * row's top, so the hit can sit below it; once seen, a repaint never undoes the reader's scroll.
 */
function revealOnce(root: HTMLElement, hit: Range, id: string): void {
	if (revealed.id !== id) revealed = { id, seen: false, tries: 0 };
	if (revealed.seen || revealed.tries >= 5) return;
	const box = hit.getBoundingClientRect();
	const view = root.getBoundingClientRect();
	if (box.height > 0 && box.top >= view.top && box.bottom <= view.bottom) {
		revealed.seen = true;
		return;
	}
	revealed.tries++;
	hit.startContainer.parentElement?.scrollIntoView({ block: "center" });
	// The row jump may land after this scroll without a repaint: look again shortly.
	setTimeout(() => {
		if (revealed.id === id && hit.startContainer.isConnected)
			revealOnce(root, hit, id);
	}, 300);
}

/** Ranges of every occurrence in an element's text, split across its text nodes. */
function rangesIn(el: HTMLElement, q: string, caseSensitive: boolean): Range[] {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let text = "";
	const starts: number[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		nodes.push(n as Text);
		starts.push(text.length);
		text += (n as Text).data;
	}
	const at = (offset: number): [Text, number] => {
		let i = 0;
		while (i + 1 < starts.length && (starts[i + 1] as number) <= offset) i++;
		return [nodes[i] as Text, offset - (starts[i] as number)];
	};
	const out: Range[] = [];
	if (nodes.length === 0) return out;
	for (const [s, e] of findOccurrences(text, q, { caseSensitive })) {
		const [sn, so] = at(s);
		const [en, eo] = at(e - 1);
		const r = document.createRange();
		r.setStart(sn, so);
		r.setEnd(en, eo + 1);
		out.push(r);
	}
	return out;
}
