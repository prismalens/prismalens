// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What a page paints for find: the shell's view, without the search's code (#1130). */
export interface FindView {
	open: boolean;
	query: string;
	caseSensitive: boolean;
	hits: [string, number][];
	current: { key: string; occurrence: number } | null;
}

const ALL = "pl-find";
const ACTIVE = "pl-find-active";

/**
 * Paint the find hits in the rows on screen. Rows are matched to hit keys by the
 * row's first event key, as the transcript draws them; the active occurrence is
 * painted brighter with a higher priority.
 */
export function paintHighlights(
	root: HTMLElement | null,
	find: FindView,
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
