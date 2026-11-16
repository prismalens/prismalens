// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread page's layout rules that code acts on (#1101, w2-research transcript-column).
 * Widths the browser draws (`--lane-w`, `--prose-w`, `--own-w`, `text-read`) live in the
 * CSS tokens; these are the numbers a component decides with. Each number lives once.
 */
export const LAYOUT = {
	/** The narrowest the thread column gets beside an open panel; past it the panel overlays. */
	laneFloor: 480,
	/** The lane's side padding, both sides together (`px-4` on the thread's column). */
	laneGutters: 32,
	/** The panel's width before a person drags it, its minimum, and how far spare width grows it. */
	panelDefault: 420,
	panelMin: 320,
	panelGrowMax: 720,
	/** A diff fence past this many lines, or touching more than one file, becomes a row. */
	diffRowLines: 40,
} as const;

/** The lane's drawn width from its token, or 0 before the document has it. */
export function laneWidth(): number {
	if (typeof document === "undefined") return 0;
	const v = getComputedStyle(document.documentElement)
		.getPropertyValue("--lane-w")
		.trim();
	return Number.parseFloat(v) || 0;
}
