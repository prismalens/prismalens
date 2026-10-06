// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Where the selected child of a row sits, so one mark can slide between
 * children (the tab underline, the segmented thumb) instead of each child
 * drawing its own. The container must be positioned.
 */
export function useSlidingMark<T extends HTMLElement>(selector: string) {
	const ref = useRef<T>(null);
	const [box, setBox] = useState<{ x: number; w: number } | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const on = el.querySelector<HTMLElement>(selector);
			setBox((prev) => {
				if (!on) return null;
				const next = { x: on.offsetLeft, w: on.offsetWidth };
				return prev && prev.x === next.x && prev.w === next.w ? prev : next;
			});
		};
		measure();
		const mo = new MutationObserver(measure);
		mo.observe(el, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-state", "aria-pressed"],
		});
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => {
			mo.disconnect();
			ro.disconnect();
		};
	}, [selector]);
	return { ref, box };
}
