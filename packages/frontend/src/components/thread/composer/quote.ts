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

const seedKey = (draft: string) => `pl.newThreadSeed.${draft}`;

export function seedNewThread(draft: string, seed: NewThreadSeed) {
	try {
		sessionStorage.setItem(seedKey(draft), JSON.stringify(seed));
	} catch {
		// No storage: New thread opens empty.
	}
}

/**
 * The seed of the New thread box with this draft id. Its chips are handed over once (the
 * draft keeps them after that, as the user edits); the fork and the agent stay for a reload.
 */
export function takeNewThreadSeed(
	draft: string | undefined,
): NewThreadSeed | null {
	if (!draft) return null;
	try {
		const raw = sessionStorage.getItem(seedKey(draft));
		if (!raw) return null;
		const seed = JSON.parse(raw) as NewThreadSeed;
		sessionStorage.setItem(
			seedKey(draft),
			JSON.stringify({ ...seed, quotes: [], references: [] }),
		);
		return seed;
	} catch {
		return null;
	}
}

/** The event key of the transcript row a selection starts in, so a citation names its message (#1195). */
export function selectionKey(node: Node | null): string | null {
	const el = node instanceof Element ? node : (node?.parentElement ?? null);
	const at = el?.closest("[data-at]")?.getAttribute("data-at");
	return at && /^[\w.-]{1,120}:\d{1,9}$/.test(at) ? at : null;
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

const heldKey = (threadId: string) => `pl.quotesFor.${threadId}`;

/** Quotes sent to a thread whose box is not open: its box takes them when it opens (#1195). */
export function holdForThread(threadId: string, q: QuoteChip) {
	try {
		const held = heldForThread(threadId);
		if (held.some((h) => h.quote.text === q.quote.text)) return;
		sessionStorage.setItem(heldKey(threadId), JSON.stringify([...held, q]));
	} catch {
		// No storage: the quote is lost, as a closed tab's would be.
	}
}

export function heldForThread(threadId: string | null): QuoteChip[] {
	if (!threadId) return [];
	try {
		const raw = sessionStorage.getItem(heldKey(threadId));
		return raw ? (JSON.parse(raw) as QuoteChip[]) : [];
	} catch {
		return [];
	}
}

export function dropHeld(threadId: string) {
	try {
		sessionStorage.removeItem(heldKey(threadId));
	} catch {
		// Nothing held.
	}
}

type OpenThread = (threadId: string, key?: string) => void;
let openThread: OpenThread | null = null;

/** The page's router for opening another thread at a message; the box stays router-free. */
export function setThreadOpener(next: OpenThread | null) {
	openThread = next;
}

/** Opens a thread, at a message when its key is known. */
export function openThreadAt(threadId: string, key?: string) {
	if (openThread) openThread(threadId, key);
	else
		window.location.assign(
			`/threads/${threadId}${key ? `#item-${encodeURIComponent(key)}` : ""}`,
		);
}

/** A quote's source: scrolled to on its own thread's page, opened at the message from anywhere else. */
export function showQuoteSource(q: Quote) {
	if (window.location.pathname.includes(q.source.threadId)) scrollToQuote(q);
	else openThreadAt(q.source.threadId, q.source.key);
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
/** Null search: the page's own subject (the thread's project or service). `draft` keys the box's own draft. */
type Go = (search: NewThreadSearch | null, draft: string) => void;
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
	// Its own draft, never the page's: a seeded box must not pick up another one (#1101).
	const draft = crypto.randomUUID();
	seedNewThread(draft, seed);
	if (go) go(search, draft);
	else window.location.assign(`/new?draft=${draft}`);
}

type ReferenceListener = (r: ReferenceRef) => void;
const refListeners = new Map<string, Set<ReferenceListener>>();

/** The thread's composer takes references from panes, as "Attach to message" in the diff (#1101 category 16). */
export function onReference(
	threadId: string,
	l: ReferenceListener,
): () => void {
	const set = refListeners.get(threadId) ?? new Set();
	set.add(l);
	refListeners.set(threadId, set);
	return () => {
		set.delete(l);
	};
}

export function sendReference(threadId: string, r: ReferenceRef): boolean {
	const set = refListeners.get(threadId);
	if (!set?.size) return false;
	set.forEach((l) => {
		l(r);
	});
	return true;
}
