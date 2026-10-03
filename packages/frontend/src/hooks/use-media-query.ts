// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";

/** Whether a media query matches; false on the server and before mount. */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => false,
	);
}

/** The list and the record sit side by side from Tailwind's `lg`. */
export const SPLIT_PANES = "(min-width: 1024px)";

/** The sidebar sits beside the page from Tailwind's `md`; below it is a top strip. */
export const SIDEBAR_BESIDE = "(min-width: 768px)";

/** The phone: below `md` the doors are a strip and each list is its own page. */
export const PHONE = "(max-width: 767px)";

/** From 1280 the sidebar is full width and carries the area's list (study-v3 §2). */
export const SIDEBAR_FULL = "(min-width: 1280px)";
