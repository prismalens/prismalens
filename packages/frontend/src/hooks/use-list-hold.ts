// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
} from "react";
import {
	type Held,
	type HeldLayout,
	heldModel,
	layoutOf,
} from "@/lib/thread-hold";
import type { ThreadListModel } from "@/lib/thread-list";

/** After the reader leaves, how long the list waits before it moves. */
export const RELEASE_MS = 600;
/** A touch or a scroll keeps the list still this long after it. */
export const TOUCH_MS = 2000;
const SLIDE_MS = 180;

let actedAt = 0;
/** A move the reader caused (pin, archive) applies at once, with whatever else waited. */
export const userMovedThreads = () => {
	actedAt = Date.now();
};

/** Open menus, peeks and ask cards inside the list keep it still. */
const OPEN = '[data-state="open"], [data-card-open]';

/**
 * Holds the list still while the reader is in it (#1247 D25): pointer over it, focus inside,
 * a row's menu or card open, or a touch or scroll in the last 2 s. Moves apply 600 ms after
 * the reader leaves, or at once through `update`, as one short slide.
 */
export function useListHold(
	ref: RefObject<HTMLElement | null>,
	live: ThreadListModel,
): Held & { update: () => void } {
	const inside = useRef(false);
	const touchedAt = useRef(0);
	const shown = useRef<HeldLayout>(layoutOf(live));
	const held = useRef<HeldLayout | null>(null);
	const slideFrom = useRef<Map<string, number> | null>(null);
	const latest = useRef(live);
	latest.current = live;
	const [, redraw] = useReducer((n: number) => n + 1, 0);

	const engaged = useCallback(() => {
		const el = ref.current;
		if (!el) return false;
		return (
			inside.current ||
			el.contains(document.activeElement) ||
			!!el.querySelector(OPEN) ||
			Date.now() - touchedAt.current < TOUCH_MS
		);
	}, [ref]);

	const release = useCallback(() => {
		if (!held.current) return;
		const el = ref.current;
		slideFrom.current = new Map(
			Array.from(
				el?.querySelectorAll<HTMLElement>('[data-testid="thread-row"]') ?? [],
			).map((r) => [r.dataset.id ?? "", r.getBoundingClientRect().top]),
		);
		// What the reader sees next is the live list; a reader still inside holds from there.
		shown.current = layoutOf(latest.current);
		held.current = null;
		redraw();
	}, [ref]);

	// The hold starts from what the reader last saw, the moment they enter the list.
	if (!held.current && engaged() && Date.now() - actedAt > 5000)
		held.current = shown.current;
	if (held.current && Date.now() - actedAt <= 5000) held.current = null;
	const result: Held = held.current
		? heldModel(live, held.current)
		: { model: live, moving: new Map(), pending: 0 };
	if (!held.current) shown.current = layoutOf(live);
	const pending = result.pending;

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (!held.current) return;
				if (engaged()) settle();
				else release();
			}, RELEASE_MS);
		};
		const enter = (e: PointerEvent) => {
			if (e.pointerType === "touch") touchedAt.current = Date.now();
			else inside.current = true;
		};
		const leave = (e: PointerEvent) => {
			if (e.pointerType !== "touch") inside.current = false;
			settle();
		};
		const touch = () => {
			touchedAt.current = Date.now();
			settle();
		};
		const onScroll = (e: Event) => {
			if (e.target instanceof Node && e.target.contains(el)) touch();
		};
		el.addEventListener("pointerenter", enter);
		el.addEventListener("pointerleave", leave);
		el.addEventListener("touchstart", touch, { passive: true });
		el.addEventListener("focusout", settle);
		document.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		if (pending) settle();
		return () => {
			clearTimeout(timer);
			el.removeEventListener("pointerenter", enter);
			el.removeEventListener("pointerleave", leave);
			el.removeEventListener("touchstart", touch);
			el.removeEventListener("focusout", settle);
			document.removeEventListener("scroll", onScroll, { capture: true });
		};
	}, [ref, engaged, release, pending]);

	// The moved rows slide from where they were; reduced motion shows the end at once.
	useLayoutEffect(() => {
		const from = slideFrom.current;
		slideFrom.current = null;
		const el = ref.current;
		if (!from || !el || matchMedia("(prefers-reduced-motion: reduce)").matches)
			return;
		for (const r of el.querySelectorAll<HTMLElement>(
			'[data-testid="thread-row"]',
		)) {
			const was = from.get(r.dataset.id ?? "");
			if (was === undefined) continue;
			const dy = was - r.getBoundingClientRect().top;
			if (Math.abs(dy) > 1)
				r.animate?.(
					[{ transform: `translateY(${dy}px)` }, { transform: "none" }],
					{ duration: SLIDE_MS, easing: "cubic-bezier(.2,.7,.2,1)" },
				);
		}
	});

	return { ...result, update: release };
}
