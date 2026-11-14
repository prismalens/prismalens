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
		// Read where layout is already clean: the observer's first call comes after layout and
		// before paint, a selection change a frame later. A read in a commit forced a page
		// layout inside the click that opened a panel (#1130).
		const measure = () => {
			const on = el.querySelector<HTMLElement>(selector);
			const next = on ? { x: on.offsetLeft, w: on.offsetWidth } : null;
			setBox((prev) =>
				next && prev && prev.x === next.x && prev.w === next.w ? prev : next,
			);
		};
		let frame = 0;
		const later = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const mo = new MutationObserver(later);
		mo.observe(el, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-state", "aria-pressed"],
		});
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => {
			cancelAnimationFrame(frame);
			mo.disconnect();
			ro.disconnect();
		};
	}, [selector]);
	return { ref, box };
}
