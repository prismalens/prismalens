// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"transcript.unseen": "thread";
	}
}

/**
 * "N new since 14:02" (#1101 cat 3 item 3): a thread with news opens here, at its
 * first unseen event. A marker, not a control: it has no menu.
 */
export const unseenDivider = defineSurface({
	id: "transcript.unseen",
	object: "thread",
	label: "New since you last read",
	menus: {},
	states: { default: "unseen-divider", phone: "unseen-divider" },
	marks: ["away"],
});

/** The divider's words: how much is new, and since when you last read. */
export function unseenLabel(count: number, since: string): string {
	return `${count} new since ${since}`;
}
