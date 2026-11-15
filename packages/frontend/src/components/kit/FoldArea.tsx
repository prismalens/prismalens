// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { UNFOLD_AREA_SHARE } from "@/lib/fold";
import { cn } from "@/lib/utils";

/** The scrolling ancestor the fold sits in: the transcript's own scroller. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const y = getComputedStyle(p).overflowY;
		if (y === "auto" || y === "scroll") return p;
	}
	return null;
}

/**
 * An opened fold that keeps your place (`UNFOLD_AREA_SHARE`, #1101 cat 12 item 6): taller
 * than that share of the visible transcript, it scrolls in place at that height. The wheel
 * passes to the page at its ends; the browser makes it keyboard-focusable; Open all lifts the cap.
 */
export function FoldArea({
	label,
	count,
	onOpenAll,
	jump,
	children,
	testId = "fold-area",
}: {
	/** What it holds, for its region name and footer: "12 rows", "48 lines". */
	label: string;
	count?: string;
	/** Absent: Open all only lifts the height cap here. */
	onOpenAll?: () => void;
	/** Scrolls the nth child into view; a new nonce repeats it (a find hit, a rail jump). */
	jump?: { index: number; nonce: number } | null;
	children: ReactNode;
	testId?: string;
}) {
	const box = useRef<HTMLElement>(null);
	const [cap, setCap] = useState<number | null>(null);
	const [over, setOver] = useState(false);
	const [lifted, setLifted] = useState(false);
	const measure = useCallback(() => {
		const el = box.current;
		if (!el) return;
		const host = scrollerOf(el);
		const max = Math.round((host?.clientHeight ?? 800) * UNFOLD_AREA_SHARE);
		setCap(max);
		setOver(el.scrollHeight > max + 1);
	}, []);
	useLayoutEffect(() => {
		measure();
		const el = box.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		const inner = el.firstElementChild;
		if (inner) ro.observe(inner);
		return () => ro.disconnect();
	}, [measure]);
	const index = jump?.index;
	const nonce = jump?.nonce;
	useLayoutEffect(() => {
		const el = box.current;
		const inner = el?.firstElementChild;
		if (!el || !inner || nonce === undefined || index === undefined) return;
		// One list child: its items are the rows.
		const list =
			inner.children.length === 1 ? (inner.firstElementChild ?? inner) : inner;
		const hit = list.children[index] as HTMLElement | undefined;
		if (hit) el.scrollTop = hit.offsetTop - el.clientHeight / 3;
	}, [index, nonce]);
	const capped = !lifted && over && cap !== null;
	return (
		<div className="flex min-w-0 flex-col" data-testid={testId}>
			<section
				ref={box}
				aria-label={capped ? label : undefined}
				className={cn(
					"relative min-w-0",
					capped &&
						"overflow-y-auto overscroll-auto rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent",
				)}
				style={capped ? { maxHeight: cap } : undefined}
				data-capped={capped || undefined}
			>
				<div className="flex min-w-0 flex-col">{children}</div>
			</section>
			{capped && (
				<button
					type="button"
					onClick={() => {
						setLifted(true);
						onOpenAll?.();
					}}
					className="mt-1 self-start text-meta text-text-3 hover:text-text-1 max-md:min-h-11"
					data-testid="fold-area-open-all"
				>
					{count ? `${count} · ` : ""}Open all
				</button>
			)}
		</div>
	);
}
