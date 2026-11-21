// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { client } from "@/lib/api/orpc-client";

type Opened = Awaited<ReturnType<typeof client.investigations.openWindow>>;
interface Landing {
	at?: string;
	position?: string;
}

/** A page that arrived before the view that reads it; past this it is stale and asked for again. */
const FRESH_MS = 30_000;
// `at` is when the page arrived; null while it is on its way, which is never stale (#1154).
const early = new Map<string, { at: number | null; page: Promise<Opened> }>();
const keyOf = (id: string, l: Landing) =>
	`${id}\0${l.at ?? ""}\0${l.position ?? ""}`;

/**
 * Starts a thread's first window page as soon as its route matches, beside the route's own
 * code and record, rather than after them (#1101 category 12: the transcript waited in series).
 */
export function prefetchWindow(id: string, landing: Landing): void {
	const key = keyOf(id, landing);
	if (early.has(key)) return;
	const page = client.investigations.openWindow({ id, fold: true, ...landing });
	const entry: { at: number | null; page: Promise<Opened> } = {
		at: null,
		page,
	};
	// A failed prefetch is asked for again by the view; never an unhandled rejection.
	page.then(
		() => {
			entry.at = Date.now();
		},
		() => early.delete(key),
	);
	early.set(key, entry);
}

/** The prefetched page for this open, once; null when there is none or it is stale. */
export function takeWindow(
	id: string,
	landing: Landing,
): Promise<Opened> | null {
	const key = keyOf(id, landing);
	const got = early.get(key);
	early.delete(key);
	return got && (got.at === null || Date.now() - got.at < FRESH_MS)
		? got.page
		: null;
}
