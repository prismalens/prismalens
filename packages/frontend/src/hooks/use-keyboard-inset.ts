// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";

/**
 * Sets `--kb-inset` to how much of the layout the on-screen keyboard covers, so the
 * composer can sit above it. Where the viewport meta's `interactive-widget=resizes-content`
 * is honoured the layout already shrinks and this stays 0; elsewhere (iOS Safari) it is the gap.
 */
export function useKeyboardInset(): void {
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const root = document.documentElement;
		let frame = 0;
		let first = 0;
		// Written only when it changes: a custom property on the root restyles the whole page,
		// and the CSS already reads 0 when it is unset (#1101 category 12).
		let shown = 0;
		const read = () => {
			const inset = Math.max(
				0,
				Math.round(window.innerHeight - vv.height - vv.offsetTop),
			);
			if (inset === shown) return;
			shown = inset;
			root.style.setProperty("--kb-inset", `${inset}px`);
		};
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(read);
		};
		// The first read waits for a painted frame: before it, the viewport read lays out the
		// whole page the mount just built (#1130).
		frame = requestAnimationFrame(() => {
			first = window.setTimeout(read, 0);
		});
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(first);
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
			root.style.removeProperty("--kb-inset");
		};
	}, []);
}
