// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Find in a thread (#1101 cat 13): the count covers the whole record and comes
 * from the server; moving to a hit loads its page; the hit is painted in place
 * with the CSS Custom Highlight API, the active one brighter.
 */
import {
	compareKeys,
	type FindScope,
	findOccurrences,
	type SearchEvents,
} from "@prismalens/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "@/lib/api/orpc-client";

const DEBOUNCE_MS = 200;

export type FindStatus = "idle" | "counting" | "ready" | "error";

export interface FindState {
	open: boolean;
	query: string;
	caseSensitive: boolean;
	scope: FindScope;
	status: FindStatus;
	total: number;
	/** 0-based across every occurrence; -1 before the first move. */
	active: number;
	/** Items with a hit, in display order: key and its occurrences. */
	hits: [string, number][];
	/** Bumped by Ctrl+F while open: the bar refocuses and selects its query. */
	focus: number;
}

/** The hit and occurrence-within-it of a flat occurrence index. */
export function locate(
	hits: readonly [string, number][],
	active: number,
): { key: string; occurrence: number } | null {
	// -1 is "no move yet": nothing is current, or an occurrence of -1 reaches Highlight.
	if (!Number.isInteger(active) || active < 0) return null;
	let left = active;
	for (const [key, count] of hits) {
		if (left < count) return { key, occurrence: left };
		left -= count;
	}
	return null;
}

/** The first occurrence at or after a key: find starts where the reader is, not at the top. */
export function firstFrom(
	hits: readonly [string, number][],
	from: string | null,
): number {
	if (!from) return 0;
	let n = 0;
	for (const [key, count] of hits) {
		if (compareKeys(key, from) >= 0) return n;
		n += count;
	}
	return 0;
}

export function useThreadFind(
	threadId: string,
	opts: {
		/** The first event key on screen. */
		viewportStart: () => string | null;
		/** Load the item's page and scroll it into view. */
		onGo: (key: string) => void;
	},
) {
	const [s, setS] = useState<FindState>({
		open: false,
		query: "",
		caseSensitive: false,
		scope: "all",
		status: "idle",
		total: 0,
		active: -1,
		hits: [],
		focus: 0,
	});
	const [retry, setRetry] = useState(0);
	const request = useRef<AbortController | null>(null);
	const optsRef = useRef(opts);
	optsRef.current = opts;

	const openFind = useCallback(() => {
		setS((p) => ({ ...p, open: true, focus: p.focus + 1 }));
	}, []);
	const close = useCallback(() => {
		request.current?.abort();
		setS((p) => ({ ...p, open: false, status: "idle", active: -1 }));
	}, []);
	const setQuery = useCallback(
		(query: string) => setS((p) => ({ ...p, query })),
		[],
	);
	const setCase = useCallback(
		(caseSensitive: boolean) => setS((p) => ({ ...p, caseSensitive })),
		[],
	);
	const setScope = useCallback(
		(scope: FindScope) => setS((p) => ({ ...p, scope })),
		[],
	);

	// Count across the whole thread, paging the hit list until it is whole.
	const { open, query, caseSensitive, scope } = s;
	useEffect(() => {
		if (!open || !query.trim()) {
			setS((p) => ({ ...p, status: "idle", total: 0, hits: [], active: -1 }));
			return;
		}
		const ctl = new AbortController();
		request.current?.abort();
		request.current = ctl;
		setS((p) => ({ ...p, status: "counting" }));
		const t = setTimeout(async () => {
			try {
				let from = 0;
				let revision: number | undefined;
				const hits: [string, number][] = [];
				let first: SearchEvents | null = null;
				for (;;) {
					const page: SearchEvents = await client.investigations.searchEvents(
						{
							id: threadId,
							q: query,
							caseSensitive,
							scope,
							from,
							...(revision !== undefined ? { revision } : {}),
						},
						{ signal: ctl.signal },
					);
					first ??= page;
					revision = page.revision;
					hits.push(...page.hits);
					if (ctl.signal.aborted) return;
					const done = page.next === null;
					// Start where the reader is, once every hit is known.
					const start = done
						? firstFrom(hits, optsRef.current.viewportStart())
						: -1;
					setS((p) => ({
						...p,
						status: done ? "ready" : "counting",
						total: first?.total ?? 0,
						hits: [...hits],
						active: p.active >= 0 ? p.active : start,
					}));
					if (page.next === null) break;
					from = page.next;
				}
			} catch {
				if (!ctl.signal.aborted) setS((p) => ({ ...p, status: "error" }));
			}
		}, DEBOUNCE_MS);
		return () => {
			clearTimeout(t);
			ctl.abort();
		};
	}, [threadId, open, query, caseSensitive, scope, retry]);

	// Reset the position when the result changes under it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts over.
	useEffect(() => {
		setS((p) => ({ ...p, active: -1 }));
	}, [query, caseSensitive, scope]);

	const move = useCallback((step: 1 | -1) => {
		setS((p) => {
			if (p.total === 0) return p;
			const loaded = p.hits.reduce((n, [, c]) => n + c, 0);
			const span = Math.max(1, loaded);
			const at =
				p.active < 0
					? step === 1
						? 0
						: span - 1
					: (p.active + step + span) % span;
			return { ...p, active: at };
		});
	}, []);

	const current = useMemo(() => locate(s.hits, s.active), [s.hits, s.active]);
	const currentKey = current?.key;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a move to the same key at a new occurrence scrolls again.
	useEffect(() => {
		if (currentKey) optsRef.current.onGo(currentKey);
	}, [currentKey, s.active]);

	return {
		...s,
		current,
		openFind,
		close,
		setQuery,
		setCase,
		setScope,
		next: () => move(1),
		prev: () => move(-1),
		retry: () => setRetry((n) => n + 1),
	};
}

export type ThreadFind = ReturnType<typeof useThreadFind>;

const ALL = "pl-find";
const ACTIVE = "pl-find-active";

/**
 * Paint the find hits in the rows on screen. Rows are matched to hit keys by the
 * row's first event key, as the transcript draws them; the active occurrence is
 * painted brighter with a higher priority.
 */
export function paintHighlights(
	root: HTMLElement | null,
	find: Pick<FindState, "open" | "query" | "caseSensitive" | "hits"> & {
		current: { key: string; occurrence: number } | null;
	},
): void {
	const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
	if (!registry || typeof Highlight === "undefined") return;
	registry.delete(ALL);
	registry.delete(ACTIVE);
	if (!root || !find.open || !find.query.trim() || find.hits.length === 0)
		return;
	// Painting is decoration: a failure leaves the hits unpainted, never the page broken. Its code
	// loads with the first hits, off the thread page's first paint (#1130).
	void import("./find-paint").then(
		(m) => m.paint(root, registry, find, ALL, ACTIVE),
		() => {},
	);
}
