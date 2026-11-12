// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread list's typed filter (#1101 category 1 item 7), kept in the URL as one
 * string: `state:waiting parent:checkout pr:failing pinned flaky test`. Each `key:value`
 * term is a removable chip; the rest searches titles.
 */
import { PR_TONES, type PrTone, THREAD_STATUSES } from "@prismalens/contracts";
import type { ListNode } from "@/lib/thread-list";
import { needsYouNow } from "@/lib/thread-status";

export const FILTER_STATES = [...THREAD_STATUSES, "needs"] as const;
export type FilterState = (typeof FILTER_STATES)[number];

export type FilterTerm =
	| { key: "state"; value: FilterState }
	| { key: "parent"; value: string }
	| { key: "pr"; value: PrTone }
	| { key: "is"; value: "pinned" };

export interface ThreadFilter {
	terms: FilterTerm[];
	text: string;
}

/** The words of each state a person types: `state:approval` or `state:needs`. */
export function parseFilter(raw: string): ThreadFilter {
	const terms: FilterTerm[] = [];
	const words: string[] = [];
	for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
		const [key, ...rest] = part.split(":");
		const value = rest.join(":").toLowerCase();
		if (key === "state" && (FILTER_STATES as readonly string[]).includes(value))
			terms.push({ key, value: value as FilterState });
		else if (key === "parent" && value) terms.push({ key, value });
		else if (key === "pr" && (PR_TONES as readonly string[]).includes(value))
			terms.push({ key, value: value as PrTone });
		else if (key === "is" && value === "pinned") terms.push({ key, value });
		else words.push(part);
	}
	return { terms, text: words.join(" ") };
}

export function formatFilter(f: ThreadFilter): string {
	return [...f.terms.map((t) => `${t.key}:${t.value}`), f.text]
		.filter(Boolean)
		.join(" ");
}

export function withoutTerm(f: ThreadFilter, i: number): ThreadFilter {
	return { ...f, terms: f.terms.filter((_, n) => n !== i) };
}

function termMatches(t: FilterTerm, n: ListNode): boolean {
	switch (t.key) {
		case "state":
			return t.value === "needs"
				? needsYouNow(n.thread, n.info)
				: n.info.status === t.value;
		case "parent": {
			const title = (n.parentTitle ?? n.thread.title ?? "").toLowerCase();
			const rootId = n.thread.tree?.rootId ?? n.id;
			return title.includes(t.value) || rootId.startsWith(t.value);
		}
		case "pr":
			return n.thread.pr?.tone === t.value;
		case "is":
			return !!n.thread.pinnedAt;
	}
}

/** Whether a thread matches every term and the text. */
export function nodeMatches(f: ThreadFilter, n: ListNode): boolean {
	const text = f.text.toLowerCase();
	if (text && !(n.thread.title ?? "").toLowerCase().includes(text))
		return false;
	return f.terms.every((t) => termMatches(t, n));
}

export const isEmptyFilter = (f: ThreadFilter) => !f.terms.length && !f.text;
