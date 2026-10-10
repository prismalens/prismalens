// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { KeyboardEvent } from "react";

const ITEMS = "[data-rove]:not(:disabled)";

/**
 * Arrow-key roving inside a chip's popover (#811): Up and Down move between
 * its `data-rove` rows and wrap, Home and End jump; disabled rows are skipped.
 */
export function roveKeys(e: KeyboardEvent<HTMLElement>): void {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
	const items = Array.from(
		e.currentTarget.querySelectorAll<HTMLElement>(ITEMS),
	);
	if (items.length === 0) return;
	e.preventDefault();
	const at = items.indexOf(document.activeElement as HTMLElement);
	const n = items.length;
	const next =
		e.key === "Home"
			? 0
			: e.key === "End"
				? n - 1
				: e.key === "ArrowDown"
					? (at + 1) % n
					: (at - 1 + n) % n;
	items[next]?.focus();
}

/** On open, focus the chosen row (else the first) instead of the popover itself. */
export function focusChosen(e: Event): void {
	const root = (e.currentTarget ?? e.target) as HTMLElement | null;
	const item =
		root?.querySelector<HTMLElement>(`${ITEMS}[data-chosen]`) ??
		root?.querySelector<HTMLElement>(ITEMS);
	if (!item) return;
	e.preventDefault();
	item.focus();
}
