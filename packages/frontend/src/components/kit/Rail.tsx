// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type KeyboardEvent, type MouseEvent, memo, useState } from "react";
import { type MarkState, markFill, markLook } from "@/components/kit/marks";
import { cn } from "@/lib/utils";

/** A break in the thread, one of the `break` mark's states; drawn as its own dash in its tone. */
export type RailBreak = MarkState<"break">;

/** What a turn with no agent words yet shows instead of an excerpt. */
export type RailTurnState = "working" | "failed" | "limited" | "silent";

export interface RailItem {
	id: string;
	/** A turn (a message and the agent's answer to it), or a break. */
	kind: "turn" | RailBreak;
	/** A turn's message, or a break's name. */
	title: string;
	/** A turn's answer excerpt as plain text, or a break's when and why. */
	body?: string;
	/** Shown when a turn has no body. */
	state?: RailTurnState;
}

/** Dashes the stack draws at most; a longer thread shows this many around where you are. */
export const RAIL_WINDOW = 15;
/** Pixels between dash centres. */
const STEP = 8;

const STATE_LOOK = {
	working: { ...markLook("run", "running"), word: "Working" },
	failed: { ...markLook("run", "failed"), word: "Failed before replying" },
	limited: { ...markLook("limit", "limited"), word: "Stopped at a limit" },
	silent: { ...markLook("run", "cancelled"), word: "No reply" },
} as const;

/** The first index of the window of `size` around `centre` in `count` items. */
export function railWindow(
	count: number,
	centre: number,
	size = RAIL_WINDOW,
): { start: number; end: number } {
	if (count <= size) return { start: 0, end: count };
	const start = Math.min(Math.max(centre - (size >> 1), 0), count - size);
	return { start, end: start + size };
}

/**
 * The transcript's rail (pattern sheet §2): a short stack of thin dashes, one
 * per turn, with each break as its own coloured dash between them. Hover or
 * keyboard focus opens the turn's card; click or Enter jumps. Arrows, Home
 * and End move the card, Page keys step breaks, F and Shift+F jump failures.
 */
export function Rail({
	items,
	current,
	hits = [],
	onJump,
	peek,
}: {
	items: RailItem[];
	current?: string;
	hits?: readonly string[];
	onJump: (id: string) => void;
	/** An item whose card shows with no pointer or keyboard on the rail (the design matrix). */
	peek?: string;
}) {
	const at = Math.max(
		items.findIndex((i) => i.id === current),
		0,
	);
	// The keyboard's place in the stack; the window follows it, hover does not.
	const [cursor, setCursor] = useState<number | null>(null);
	const [hover, setHover] = useState<number | null>(null);
	const peeked = items.findIndex((i) => i.id === peek);
	const { start, end } = railWindow(
		items.length,
		cursor ?? (peeked >= 0 ? peeked : at),
	);
	const shown = hover ?? cursor ?? (peeked >= 0 ? peeked : null);
	const hit = new Set(hits);
	const slot = (e: MouseEvent<HTMLElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		const i = start + Math.floor((e.clientY - r.top) / STEP);
		return Math.min(Math.max(i, start), end - 1);
	};
	const step = (from: number, dir: 1 | -1, only: (it: RailItem) => boolean) => {
		for (let i = from + dir; i >= 0 && i < items.length; i += dir)
			if (only(items[i])) return i;
		return null;
	};
	const onKey = (e: KeyboardEvent) => {
		// Ctrl+F stays find's.
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const from = cursor ?? at;
		const any = () => true;
		const brk = (it: RailItem) => it.kind !== "turn";
		const failure = (it: RailItem) => it.kind === "failure";
		const move: Record<string, () => number | null> = {
			ArrowDown: () => step(from, 1, any),
			ArrowUp: () => step(from, -1, any),
			PageDown: () => step(from, 1, brk),
			PageUp: () => step(from, -1, brk),
			Home: () => 0,
			End: () => items.length - 1,
		};
		if (e.key in move) {
			e.preventDefault();
			setCursor(move[e.key]() ?? from);
			return;
		}
		const jump =
			e.key === "Enter" || e.key === " "
				? from
				: e.key === "f"
					? step(from, 1, failure)
					: e.key === "F"
						? step(from, -1, failure)
						: undefined;
		if (jump === undefined) {
			if (e.key === "Escape") setCursor(null);
			return;
		}
		e.preventDefault();
		if (jump === null) return;
		setCursor(jump);
		onJump(items[jump].id);
	};
	const windowed = items.slice(start, end);
	const clipped = { top: start > 0, bottom: end < items.length };
	const card = shown !== null ? items[shown] : undefined;
	return (
		<>
			<div
				role="slider"
				tabIndex={0}
				aria-label="Turns"
				aria-keyshortcuts="F Shift+F"
				aria-orientation="vertical"
				aria-valuemin={1}
				aria-valuemax={Math.max(items.length, 1)}
				aria-valuenow={(cursor ?? at) + 1}
				aria-valuetext={items[cursor ?? at]?.title}
				className="group/rail relative w-8 cursor-pointer rounded-sm outline-none focus-visible:outline-1 focus-visible:outline-accent"
				style={{ height: windowed.length * STEP }}
				data-testid="rail"
				onPointerMove={(e) => setHover(slot(e))}
				onPointerLeave={() => setHover(null)}
				onClick={(e) => {
					const i = slot(e);
					setHover(null);
					onJump(items[i].id);
				}}
				onKeyDown={onKey}
				onFocus={(e) => {
					if (e.target.matches(":focus-visible")) setCursor(at);
				}}
				onBlur={() => setCursor(null)}
			>
				{windowed.map((it, k) => {
					const i = start + k;
					const brk = it.kind === "turn" ? null : it.kind;
					const lit = i === shown;
					const here = i === at;
					// The window's two end dashes fade when more lies beyond them.
					const edge =
						(clipped.top && k < 2 ? k : null) ??
						(clipped.bottom && windowed.length - 1 - k < 2
							? windowed.length - 1 - k
							: null);
					return (
						<span
							key={it.id}
							aria-hidden
							className={cn(
								"absolute left-1 block h-0.5 -translate-y-1/2 rounded-full transition-[width,background-color] duration-150",
								lit ? "w-5" : here ? "w-3.5" : "w-2",
								brk
									? markFill("break", brk)
									: lit || hit.has(it.id)
										? "bg-text-1"
										: here
											? "bg-text-2"
											: "bg-text-3/35 group-hover/rail:bg-text-3/55",
							)}
							style={{
								top: k * STEP + STEP / 2,
								opacity: edge === null ? undefined : edge === 0 ? 0.3 : 0.6,
							}}
							data-rail-item={it.kind}
							data-current={here || undefined}
							data-hit={hit.has(it.id) || undefined}
						/>
					);
				})}
				{card && (
					<RailCard
						item={card}
						top={((shown ?? 0) - start) * STEP + STEP / 2}
					/>
				)}
			</div>
			<RailLinks items={items} current={at} onJump={onJump} />
		</>
	);
}

/** The hovered or focused item's card, beside its dash; display only. */
function RailCard({ item, top }: { item: RailItem; top: number }) {
	const brk = item.kind === "turn" ? null : item.kind;
	const look = brk ? markLook("break", brk) : null;
	const state =
		!brk && !item.body && item.state ? STATE_LOOK[item.state] : null;
	return (
		<span
			className="floating pointer-events-none absolute left-9 z-50 block w-80 -translate-y-1/2 rounded-pool p-3 text-left"
			style={{ top }}
			data-testid="rail-card"
		>
			<span className="flex items-center gap-1.5 text-body font-semibold text-text-1">
				{look && (
					<look.icon
						aria-hidden
						className={cn("size-3.5 shrink-0", look.className)}
					/>
				)}
				<span className="truncate">{item.title || "Your message"}</span>
			</span>
			{item.body ? (
				<span className="mt-1 line-clamp-3 block text-body text-text-2">
					{item.body}
				</span>
			) : state ? (
				<span className="mt-1 flex items-center gap-1.5 text-body text-text-2">
					<state.icon aria-hidden className={cn("size-3.5", state.className)} />
					{state.word}
				</span>
			) : null}
		</span>
	);
}

/**
 * The rail as jump links for a screen reader (#1101 bar 14.6), one per dash,
 * out of the tab order; the slider is the keyboard's control.
 */
const RailLinks = memo(function RailLinks({
	items,
	current,
	onJump,
}: {
	items: RailItem[];
	current: number;
	onJump: (id: string) => void;
}) {
	if (!items.length) return null;
	return (
		<ol
			aria-label="Jump to a turn"
			className="sr-only"
			data-testid="rail-links"
		>
			{items.map((it, i) => (
				<li key={it.id}>
					<button
						type="button"
						tabIndex={-1}
						aria-current={i === current || undefined}
						onClick={() => onJump(it.id)}
					>
						{it.kind === "turn"
							? it.title || "Your message"
							: [it.title, it.body].filter(Boolean).join(", ")}
					</button>
				</li>
			))}
		</ol>
	);
});
