// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The item a `#item-<key>` link opens a thread at, if any. */
export function itemFromHash(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const m = /^#item-(.+)$/.exec(window.location.hash);
	return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/** Where a thread opens: at a linked item, else at its first unseen event (#1101 category 3). */
export function threadLanding(): { at?: string; position?: string } {
	const at = itemFromHash();
	return at ? { at } : { position: "unread" };
}
