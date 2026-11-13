// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type KeyboardEvent,
	type MouseEvent,
	useEffect,
	useRef,
	useState,
} from "react";
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

const MARK_RANK: Record<NonNullable<RailItem["mark"]>, number> = {
	failure: 4,
	limit: 3,
	restart: 2,
	compaction: 1,
};

/** One drawn tick: the items that would touch at this height, merged. */
export interface RailTick {
	at: number;
	/** Index of the first member in `items`; the tick's key and hover target. */
	first: number;
	last: number;
	author: RailItem["author"];
	mark?: RailItem["mark"];
	current: boolean;
	hit: boolean;
}

/**
 * Items closer than `gap` px at this height merge into one tick: the agent's
 * length if any member is the agent's, the strongest mark, current or hit if
 * any member is. Unmeasured (height 0), every item is its own tick.
 */
export function clusterTicks(
	items: RailItem[],
	height: number,
	current: number,
	hits: ReadonlySet<string>,
	gap = 3,
): RailTick[] {
	const ticks: RailTick[] = [];
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		const last = ticks[ticks.length - 1];
		if (last && height > 0 && (it.at - last.at) * height < gap) {
			last.last = i;
			if (
				it.author === "agent" ||
				(it.author === "you" && last.author === "thread")
			)
				last.author = it.author;
			if (it.mark && (!last.mark || MARK_RANK[it.mark] > MARK_RANK[last.mark]))
				last.mark = it.mark;
			last.current ||= i === current;
			last.hit ||= hits.has(it.id);
			continue;
		}
		ticks.push({
			at: it.at,
			first: i,
			last: i,
			author: it.author,
			mark: it.mark,
			current: i === current,
			hit: hits.has(it.id),
		});
	}
	return ticks;
}

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
 * One control: arrows step turns, Page keys step marks, F and Shift+F step
 * failures, hover previews.
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
	const [height, setHeight] = useState(0);
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const hit = new Set(hits);
	const at = items.findIndex((i) => i.id === current);
	const ticks = clusterTicks(items, height, at, hit);
	const index = (e: MouseEvent) => {
		const r = ref.current?.getBoundingClientRect();
		if (!r || !items.length) return null;
		return nearest(items, (e.clientY - r.top) / r.height);
	};
	const step = (
		from: number,
		dir: 1 | -1,
		only: (it: RailItem) => boolean = () => true,
	) => {
		for (let i = from + dir; i >= 0 && i < items.length; i += dir)
			if (only(items[i])) return i;
		return from;
	};
	const marked = (it: RailItem) => !!it.mark;
	const failure = (it: RailItem) => it.mark === "failure";
	const onKey = (e: KeyboardEvent) => {
		// Ctrl+F stays find's.
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const from = Math.max(at, 0);
		const keys: Record<string, () => number> = {
			ArrowDown: () => step(from, 1),
			ArrowUp: () => step(from, -1),
			PageDown: () => step(from, 1, marked),
			PageUp: () => step(from, -1, marked),
			f: () => step(from, 1, failure),
			F: () => step(from, -1, failure),
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
		<>
			<div
				ref={ref}
				role="slider"
				tabIndex={0}
				aria-label="Transcript rail"
				aria-keyshortcuts="F Shift+F"
				aria-orientation="vertical"
				aria-valuemin={0}
				aria-valuemax={Math.max(items.length - 1, 0)}
				aria-valuenow={Math.max(at, 0)}
				aria-valuetext={items[at]?.preview}
				className="group/rail relative h-full w-6 shrink-0 cursor-pointer outline-none"
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
				{ticks.map((t) => {
					const hovered = hover !== null && hover >= t.first && hover <= t.last;
					return (
						<span
							key={items[t.first].id}
							aria-hidden
							className={cn(
								"absolute left-1 block",
								// Focus is quiet: the lines brighten and the current tick gets a 1 px outline.
								t.current &&
									"group-focus-visible/rail:bg-text-1 group-focus-visible/rail:outline group-focus-visible/rail:outline-offset-2 group-focus-visible/rail:outline-accent",
								t.mark ? "h-0.5 w-4" : cn("h-px", AUTHOR_W[t.author]),
								t.mark
									? MARK_BG[t.mark]
									: t.hit
										? "bg-text-1"
										: t.current || hovered
											? "bg-text-2"
											: "bg-text-3/25 group-hover/rail:bg-text-3/50 group-focus-visible/rail:bg-text-3/50",
							)}
							style={{ top: `${t.at * 100}%` }}
							data-rail-item={t.mark ?? t.author}
							data-current={t.current || undefined}
							data-hit={t.hit || undefined}
						/>
					);
				})}
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
			<RailLinks items={items} ticks={ticks} onJump={onJump} />
		</>
	);
}

/**
 * The rail as a list of jump links for a screen reader (#1101 bar 14.6): one
 * per drawn tick, so a 5,000-turn thread lists hundreds, not thousands. Out of
 * the tab order; the slider is the keyboard's control.
 */
function RailLinks({
	items,
	ticks,
	onJump,
}: {
	items: RailItem[];
	ticks: RailTick[];
	onJump: (id: string) => void;
}) {
	if (!ticks.length) return null;
	return (
		<nav
			aria-label="Transcript turns"
			className="sr-only"
			data-testid="rail-links"
		>
			<ol>
				{ticks.map((t) => {
					const it = items[t.first];
					const more = t.last - t.first;
					return (
						<li key={it.id}>
							<button
								type="button"
								tabIndex={-1}
								aria-current={t.current || undefined}
								onClick={() => onJump(it.id)}
							>
								{`${RAIL_WHO[t.mark ?? t.author]}: ${it.preview}${more ? ` (and ${more} more)` : ""}`}
							</button>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

const RAIL_WHO: Record<
	RailItem["author"] | NonNullable<RailItem["mark"]>,
	string
> = {
	you: "You",
	agent: "Agent",
	thread: "Thread",
	limit: "Limit",
	failure: "Failure",
	restart: "Restart",
	compaction: "Compaction",
};
