// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

/**
 * One overview card (#811, card heights ruling): a fixed header, and a body
 * that scrolls inside the card. Rows marked `data-row` are counted, so what
 * does not fit says "N more" (a fade alone read as disabled in review).
 */
export function Card({
	title,
	sub,
	actions,
	children,
	testId,
	className,
	id,
}: {
	title: string;
	sub?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	testId: string;
	className?: string;
	id?: string;
}) {
	const h = useId();
	return (
		<section
			id={id}
			aria-labelledby={h}
			className={cn(
				"flex min-h-0 min-w-0 flex-col gap-2.5 rounded-pool bg-surface-1 px-4 pt-3.5 pb-3",
				className,
			)}
			data-testid={testId}
		>
			<div className="flex min-w-0 shrink-0 items-baseline gap-3 whitespace-nowrap">
				<h2 id={h} className="shrink-0 text-heading">
					{title}
				</h2>
				{sub}
				<span className="flex-1" />
				{actions}
			</div>
			<ScrollBody>{children}</ScrollBody>
		</section>
	);
}

/** Rows below the visible part of `el`; a row cut at the bottom counts. */
function hiddenBelow(el: HTMLElement): { rows: number; more: boolean } {
	const bottom = el.scrollTop + el.clientHeight;
	const more = el.scrollHeight - bottom > 2;
	if (!more) return { rows: 0, more };
	const top = el.getBoundingClientRect().top - el.scrollTop;
	let rows = 0;
	for (const row of Array.from(
		el.querySelectorAll<HTMLElement>("[data-row]"),
	)) {
		const r = row.getBoundingClientRect();
		if (r.bottom - top > bottom + 2) rows++;
	}
	return { rows, more };
}

export function ScrollBody({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [state, setState] = useState({ rows: 0, more: false });
	const measure = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const next = hiddenBelow(el);
		setState((s) => (s.rows === next.rows && s.more === next.more ? s : next));
	}, []);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		const mo = new MutationObserver(measure);
		mo.observe(el, { childList: true, subtree: true, characterData: true });
		for (const c of Array.from(el.children)) ro.observe(c);
		return () => {
			ro.disconnect();
			mo.disconnect();
		};
	}, [measure]);
	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={ref}
				onScroll={measure}
				className={cn(
					"h-full overflow-y-auto overscroll-contain [scrollbar-width:thin]",
					className,
				)}
				data-testid="card-body"
			>
				{children}
			</div>
			{state.more && (
				<button
					type="button"
					onClick={() =>
						ref.current?.scrollBy({
							top: ref.current.clientHeight * 0.8,
							behavior: "smooth",
						})
					}
					className="absolute right-0 bottom-0 flex h-6 items-center gap-1 rounded-control bg-surface-3 px-2 text-meta text-text-1 shadow-float transition-colors duration-(--dur-instant) hover:bg-surface-4"
					data-testid="card-more"
				>
					{state.rows > 0 ? `${state.rows} more` : "More below"}
					<ChevronDown className="size-3" aria-hidden />
				</button>
			)}
		</div>
	);
}
