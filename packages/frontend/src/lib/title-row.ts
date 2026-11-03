// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { desktopBridge, titleRowHeight } from "./desktop";

const ROWS = "[data-title-row]";

/** How far the window controls reach in from each side of the title row, in px. */
export interface Controls {
	left: number;
	right: number;
}

/**
 * Gives each title row the width of the window controls it runs under, at
 * either end (#1020); tokens.css pads the row by it, so no control sits beneath.
 */
export function markTitleRowEdges(
	doc: Document,
	rowHeight: number,
	controls: Controls,
): void {
	const width = doc.defaultView?.innerWidth ?? 0;
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>(ROWS))) {
		const r = el.getBoundingClientRect();
		const top = r.height > 0 && r.top < rowHeight;
		const left = top ? Math.max(0, Math.ceil(controls.left - r.left)) : 0;
		const right = top
			? Math.max(0, Math.ceil(r.right - (width - controls.right)))
			: 0;
		edge(el, "left", left);
		edge(el, "right", right);
	}
}

function edge(el: HTMLElement, side: "left" | "right", px: number) {
	el.toggleAttribute(`data-edge-${side}`, px > 0);
	if (px > 0) el.style.setProperty(`--edge-${side}`, `${px}px`);
	else el.style.removeProperty(`--edge-${side}`);
}

/** Reads `--controls-left` / `--controls-right` (tokens.css, from the overlay's env()) as px. */
function controlsOf(probe: HTMLElement): Controls {
	const style = getComputedStyle(probe);
	return {
		left: Number.parseFloat(style.paddingLeft) || 0,
		right: Number.parseFloat(style.paddingRight) || 0,
	};
}

/** Keeps the marks current as rows mount, panels resize and the window changes; desktop only. */
export function useTitleRowEdges(): void {
	useEffect(() => {
		if (!desktopBridge()) return;
		const probe = document.createElement("div");
		probe.setAttribute("aria-hidden", "true");
		probe.style.cssText =
			"position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:0 var(--controls-right) 0 var(--controls-left)";
		document.body.append(probe);
		let frame = 0;
		const watched = new WeakSet<Element>();
		const resize = new ResizeObserver(() => schedule());
		const run = () => {
			frame = 0;
			for (const el of Array.from(document.querySelectorAll(ROWS)))
				if (!watched.has(el)) {
					watched.add(el);
					resize.observe(el);
				}
			markTitleRowEdges(document, titleRowHeight(), controlsOf(probe));
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(run);
		};
		const mutation = new MutationObserver(schedule);
		mutation.observe(document.body, { childList: true, subtree: true });
		window.addEventListener("resize", schedule);
		schedule();
		return () => {
			cancelAnimationFrame(frame);
			mutation.disconnect();
			resize.disconnect();
			window.removeEventListener("resize", schedule);
			probe.remove();
		};
	}, []);
}
