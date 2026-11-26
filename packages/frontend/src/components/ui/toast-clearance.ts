// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type RefObject, useEffect } from "react";

/**
 * Lifts the toast stack above `ref` (a docked composer) while it is mounted: no toast
 * covers a control (#1101 cat 23).
 */
export function useToastClearance(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const root = document.documentElement.style;
		const set = () =>
			root.setProperty(
				"--toast-clear",
				`${Math.max(0, window.innerHeight - el.getBoundingClientRect().top)}px`,
			);
		const seen = new ResizeObserver(set);
		seen.observe(el);
		window.addEventListener("resize", set);
		set();
		return () => {
			seen.disconnect();
			window.removeEventListener("resize", set);
			root.removeProperty("--toast-clear");
		};
	}, [ref]);
}
