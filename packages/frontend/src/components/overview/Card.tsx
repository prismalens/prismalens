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

interface Overflow {
	/** The content is taller than the body: the foot row shows. */
	overflows: boolean;
	/** Rows not yet in view below; a row cut at the bottom counts. */
	rows: number;
	atEnd: boolean;
}

function overflowOf(el: HTMLElement): Overflow {
	const overflows = el.scrollHeight - el.clientHeight > 2;
	const bottom = el.scrollTop + el.clientHeight;
	const atEnd = el.scrollHeight - bottom <= 2;
	if (!overflows || atEnd) return { overflows, rows: 0, atEnd };
	const top = el.getBoundingClientRect().top - el.scrollTop;
	let rows = 0;
	for (const row of Array.from(
		el.querySelectorAll<HTMLElement>("[data-row]"),
	)) {
		if (row.getBoundingClientRect().bottom - top > bottom + 2) rows++;
	}
	return { overflows, rows, atEnd };
}

const same = (a: Overflow, b: Overflow) =>
	a.overflows === b.overflows && a.rows === b.rows && a.atEnd === b.atEnd;

/**
 * The card's scrolling body. While its content overflows, a foot row of its
 * own (never over the content) says how many rows are below; at the end it
 * offers the way back up.
 */
export function ScrollBody({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<Overflow>({
		overflows: false,
		rows: 0,
		atEnd: true,
	});
	const measure = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const next = overflowOf(el);
		setState((s) => (same(s, next) ? s : next));
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
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				ref={ref}
				onScroll={measure}
				className={cn(
					"min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]",
					className,
				)}
				data-testid="card-body"
			>
				{children}
			</div>
			{state.overflows && (
				<div className="flex h-6 shrink-0 items-end justify-end">
					<button
						type="button"
						onClick={() => {
							const el = ref.current;
							if (!el) return;
							if (state.atEnd) el.scrollTo({ top: 0, behavior: "smooth" });
							else
								el.scrollBy({ top: el.clientHeight * 0.8, behavior: "smooth" });
						}}
						className="flex items-center gap-1 rounded-control px-1.5 text-meta text-accent transition-colors duration-(--dur-instant) hover:bg-surface-3"
						data-testid="card-more"
					>
						{state.atEnd
							? "Back to top"
							: state.rows > 0
								? `${state.rows} more`
								: "More below"}
						<ChevronDown
							className={cn("size-3", state.atEnd && "rotate-180")}
							aria-hidden
						/>
					</button>
				</div>
			)}
		</div>
	);
}
