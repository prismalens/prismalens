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
