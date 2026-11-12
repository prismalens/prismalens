// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";

export interface RailItem {
	id: string;
	/** Position down the transcript, 0 at the top and 1 at the end. */
	at: number;
	author: "you" | "agent" | "thread";
	/** An event worth finding again; drawn as a full-width line in its colour. */
	mark?: "limit" | "failure" | "restart" | "compaction";
	/** One line, shown on hover. */
	preview: string;
}

const AUTHOR_W: Record<RailItem["author"], string> = {
	agent: "w-3.5",
	you: "w-2",
	thread: "w-1",
};
const MARK_BG: Record<NonNullable<RailItem["mark"]>, string> = {
	limit: "bg-warn",
	failure: "bg-danger",
	restart: "bg-info",
	compaction: "bg-text-3",
};

/** The item nearest a fraction of the height; items are sorted by `at`. */
export function nearest(items: RailItem[], at: number): number {
	let lo = 0;
	let hi = items.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (items[mid].at < at) lo = mid + 1;
		else hi = mid;
	}
	if (lo > 0 && at - items[lo - 1].at < items[lo].at - at) return lo - 1;
	return lo;
}

/**
 * The transcript's rail on the left edge (pattern sheet §2): thin lines, one
 * per turn, long for the agent and short for you; marks in a status colour.
 * One control: arrows step turns, Page keys step marks, hover previews.
 */
export function Rail({
	items,
	current,
	hits = [],
	onJump,
}: {
	items: RailItem[];
	current?: string;
	hits?: string[];
	onJump: (id: string) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [hover, setHover] = useState<number | null>(null);
	const hit = new Set(hits);
	const at = items.findIndex((i) => i.id === current);
	const index = (e: MouseEvent) => {
		const r = ref.current?.getBoundingClientRect();
		if (!r || !items.length) return null;
		return nearest(items, (e.clientY - r.top) / r.height);
	};
	const step = (from: number, dir: 1 | -1, marksOnly: boolean) => {
		for (let i = from + dir; i >= 0 && i < items.length; i += dir)
			if (!marksOnly || items[i].mark) return i;
		return from;
	};
	const onKey = (e: KeyboardEvent) => {
		const from = Math.max(at, 0);
		const keys: Record<string, () => number> = {
			ArrowDown: () => step(from, 1, false),
			ArrowUp: () => step(from, -1, false),
			PageDown: () => step(from, 1, true),
			PageUp: () => step(from, -1, true),
			Home: () => 0,
			End: () => items.length - 1,
		};
		const to = keys[e.key]?.();
		if (to === undefined || !items[to]) return;
		e.preventDefault();
		onJump(items[to].id);
	};
	const [focused, setFocused] = useState(false);
	// Keyboard steps preview the turn they land on, as hover does.
	const shown = hover ?? (focused && at >= 0 ? at : null);
	return (
		<div
			ref={ref}
			role="slider"
			tabIndex={0}
			aria-label="Transcript rail"
			aria-orientation="vertical"
			aria-valuemin={0}
			aria-valuemax={Math.max(items.length - 1, 0)}
			aria-valuenow={Math.max(at, 0)}
			aria-valuetext={items[at]?.preview}
			className="relative h-full w-6 shrink-0 cursor-pointer rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
			data-testid="rail"
			onPointerMove={(e) => setHover(index(e))}
			onPointerLeave={() => setHover(null)}
			onClick={(e) => {
				const i = index(e);
				if (i !== null) onJump(items[i].id);
			}}
			onKeyDown={onKey}
			onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
			onBlur={() => setFocused(false)}
		>
			{items.map((it, i) => (
				<span
					key={it.id}
					aria-hidden
					className={cn(
						"absolute left-1 block",
						it.mark ? "h-0.5 w-4" : cn("h-px", AUTHOR_W[it.author]),
						it.mark
							? MARK_BG[it.mark]
							: hit.has(it.id)
								? "bg-text-1"
								: i === at || i === hover
									? "bg-text-2"
									: "bg-text-3/45",
					)}
					style={{ top: `${it.at * 100}%` }}
					data-rail-item={it.mark ?? it.author}
					data-current={i === at || undefined}
					data-hit={hit.has(it.id) || undefined}
				/>
			))}
			{shown !== null && items[shown] && (
				<Hint label={items[shown].preview} side="right" open>
					<span
						aria-hidden
						className="pointer-events-none absolute left-full block h-px w-0"
						style={{ top: `${items[shown].at * 100}%` }}
					/>
				</Hint>
			)}
		</div>
	);
}
