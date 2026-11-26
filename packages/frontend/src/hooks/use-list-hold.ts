// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	type Held,
	type HeldLayout,
	heldModel,
	layoutOf,
	rebase,
} from "@/lib/thread-hold";
import type { ThreadListModel } from "@/lib/thread-list";

/** After the reader leaves, how long the list waits before it moves. */
export const RELEASE_MS = 600;
/** A touch or a scroll keeps the list still this long after it. */
export const TOUCH_MS = 2000;
const SLIDE_MS = 180;
/** How long a move the reader made waits to reach the list before it counts as any other. */
const OWN_MS = 5000;

const moved = new Map<string, number>();
/** Threads the reader moved (pin, archive): their move applies at once; the rest stay held. */
export const userMovedThreads = (ids: readonly string[]) => {
	for (const id of ids) moved.set(id, Date.now());
};
const ownMoves = () =>
	new Set(
		[...moved].filter(([, at]) => Date.now() - at <= OWN_MS).map(([id]) => id),
	);

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
	// The list can mount after a loading render, so the listeners follow the element.
	const [el, setEl] = useState<HTMLElement | null>(null);
	const inside = useRef(false);
	const touchedAt = useRef(0);
	const shown = useRef<HeldLayout | null>(null);
	const held = useRef<HeldLayout | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const slideFrom = useRef<Map<string, number> | null>(null);
	const latest = useRef(live);
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
		slideFrom.current = new Map(
			Array.from(
				ref.current?.querySelectorAll<HTMLElement>(
					'[data-testid="thread-row"]',
				) ?? [],
			).map((r) => [r.dataset.id ?? "", r.getBoundingClientRect().top]),
		);
		// What the reader sees next is the live list; a reader still inside holds from there.
		shown.current = layoutOf(latest.current);
		held.current = engaged() ? shown.current : null;
		redraw();
	}, [ref, engaged]);

	// The deadline runs from the reader's last activity; more moves arriving don't push it.
	const settle = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = undefined;
			if (!held.current) return;
			if (engaged()) settle();
			else release();
		}, RELEASE_MS);
	}, [engaged, release]);

	const own = ownMoves();
	const base =
		held.current && own.size ? rebase(held.current, live, own) : held.current;
	const result: Held = base
		? heldModel(live, base)
		: { model: live, moving: new Map(), pending: 0 };
	const pending = result.pending;

	// Only a committed render sets what the reader saw, and a move they made joins the hold.
	useLayoutEffect(() => {
		if (ref.current !== el) setEl(ref.current);
		latest.current = live;
		if (held.current && base !== held.current) {
			held.current = base;
			for (const id of own) moved.delete(id);
		}
		if (!held.current) shown.current = layoutOf(live);
	});

	useEffect(() => {
		if (!el) return;
		// The hold starts from what the reader last saw, the moment they enter the list.
		const begin = () => {
			if (!held.current && shown.current) held.current = shown.current;
		};
		const enter = (e: PointerEvent) => {
			if (e.pointerType === "touch") touchedAt.current = Date.now();
			else inside.current = true;
			begin();
		};
		const leave = (e: PointerEvent) => {
			if (e.pointerType !== "touch") inside.current = false;
			settle();
		};
		const touch = () => {
			touchedAt.current = Date.now();
			begin();
			settle();
		};
		const onScroll = (e: Event) => {
			if (e.target instanceof Node && e.target.contains(el)) touch();
		};
		el.addEventListener("pointerenter", enter);
		el.addEventListener("pointerleave", leave);
		el.addEventListener("touchstart", touch, { passive: true });
		el.addEventListener("focusin", begin);
		el.addEventListener("focusout", settle);
		document.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () => {
			el.removeEventListener("pointerenter", enter);
			el.removeEventListener("pointerleave", leave);
			el.removeEventListener("touchstart", touch);
			el.removeEventListener("focusin", begin);
			el.removeEventListener("focusout", settle);
			document.removeEventListener("scroll", onScroll, { capture: true });
		};
	}, [el, settle]);

	useEffect(() => {
		if (pending && !timer.current) settle();
	}, [pending, settle]);
	useEffect(() => () => clearTimeout(timer.current), []);
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
