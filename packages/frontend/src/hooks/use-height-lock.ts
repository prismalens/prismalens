// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type Ref, type RefCallback, useCallback, useRef } from "react";

/**
 * A dialog's height never shrinks while it is open: a field that toggles or
 * a validation line that clears does not resize it. Capped at 80dvh, where
 * the dialog scrolls inside.
 */
export function useHeightLock<T extends HTMLElement>(
	forwarded: Ref<T>,
): RefCallback<T> {
	const observer = useRef<ResizeObserver | null>(null);
	return useCallback(
		(node: T | null) => {
			observer.current?.disconnect();
			observer.current = null;
			if (typeof forwarded === "function") forwarded(node);
			else if (forwarded) forwarded.current = node;
			if (!node || typeof ResizeObserver === "undefined") return;
			let tallest = 0;
			observer.current = new ResizeObserver(() => {
				const cap = window.innerHeight * 0.8;
				const h = Math.min(node.offsetHeight, cap);
				if (h > tallest) {
					tallest = h;
					node.style.minHeight = `${h}px`;
				}
			});
			observer.current.observe(node);
		},
		[forwarded],
	);
}
