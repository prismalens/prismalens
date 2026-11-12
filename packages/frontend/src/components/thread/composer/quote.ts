// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { Quote, ReferenceRef } from "@prismalens/contracts";

/** A quote is cut here (#1024); the chip says so. */
export const QUOTE_CAP_CHARS = 4000;

export interface QuoteChip {
	key: string;
	quote: Quote;
	cut: boolean;
}

/** A selection as a quote, cut to the cap. */
export function quoteOf(
	text: string,
	source: Quote["source"],
): QuoteChip | null {
	const clean = text.replace(/\r\n/g, "\n").trim();
	if (!clean) return null;
	const cut = clean.length > QUOTE_CAP_CHARS;
	return {
		key: crypto.randomUUID(),
		quote: { source, text: cut ? clean.slice(0, QUOTE_CAP_CHARS) : clean },
		cut,
	};
}

/** The chip's line: the quote's first line. */
export const firstLine = (q: Quote) =>
	(q.text.split("\n").find((l) => l.trim()) ?? q.text).trim();

type QuoteListener = (q: QuoteChip) => void;
const listeners = new Map<string, Set<QuoteListener>>();

/** The thread's composer takes quotes from the selection popover, which lives in a page slot. */
export function onQuote(threadId: string, l: QuoteListener): () => void {
	const set = listeners.get(threadId) ?? new Set();
	set.add(l);
	listeners.set(threadId, set);
	return () => {
		set.delete(l);
	};
}

export function sendQuote(threadId: string, q: QuoteChip): boolean {
	const set = listeners.get(threadId);
	if (!set?.size) return false;
	set.forEach((l) => {
		l(q);
	});
	return true;
}

/** What the next New thread box starts with: "Ask in a new thread", `/new` (#1024). */
export interface NewThreadSeed {
	quotes: QuoteChip[];
	references: ReferenceRef[];
	/** Fork from a response: the send makes a child of this thread (#1101 sheet §2). */
	forkOf?: { id: string };
	harness?: HarnessId;
	model?: string;
}

const SEED_KEY = "pl.newThreadSeed";

export function seedNewThread(seed: NewThreadSeed) {
	try {
		sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
	} catch {
		// No storage: New thread opens empty.
	}
}

/** Read once by the New thread box; a reload after that starts clean. */
export function takeNewThreadSeed(): NewThreadSeed | null {
	try {
		const raw = sessionStorage.getItem(SEED_KEY);
		sessionStorage.removeItem(SEED_KEY);
		return raw ? (JSON.parse(raw) as NewThreadSeed) : null;
	} catch {
		return null;
	}
}

/** Where a selection in the thread came from, by the region it sits in. */
export function selectionSource(
	node: Node | null,
): Quote["source"]["kind"] | null {
	const el = node instanceof Element ? node : (node?.parentElement ?? null);
	if (!el?.closest('[data-testid="transcript"]')) return null;
	if (el.closest('[data-testid="transcript-report"]')) return "report";
	if (el.closest("pre, [data-testid*='tool']")) return "tool_output";
	return "transcript";
}

/** Scrolls the transcript to the message a quote came from, found by its first line. */
export function scrollToQuote(q: Quote) {
	const line = firstLine(q).slice(0, 80);
	const root = document.querySelector('[data-testid="transcript"]');
	if (!root || !line) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode())
		if (n.textContent?.includes(line)) {
			n.parentElement?.scrollIntoView({ block: "center" });
			return;
		}
}

export type NewThreadSearch = {
	project?: string;
	service?: string;
	none?: true;
};
/** Null search: the page's own subject (the thread's project or service). */
type Go = (search: NewThreadSearch | null) => void;
let go: Go | null = null;

/** The page's router, registered by the composer's page slot; the box itself stays router-free. */
export function setNewThreadNavigator(next: Go | null) {
	go = next;
}

/** Opens New thread with `seed`: "Ask in a new thread" and `/new` (#1024). */
export function openNewThread(
	seed: NewThreadSeed,
	search: NewThreadSearch | null = null,
) {
	seedNewThread(seed);
	if (go) go(search);
	else window.location.assign("/new");
}
