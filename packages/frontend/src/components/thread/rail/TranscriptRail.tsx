// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The transcript rail (#1101 cat 14): one tick per message across the whole thread,
 * from the light index, so a tick can point where no page is loaded. Ticks vary by
 * author, typed marks name what broke the thread, find hits ride their own lane.
 * It is a list of jump links with one tab stop; arrow keys move along it.
 */
import {
	type IndexAuthor,
	type IndexEntry,
	parseEventKey,
	type RailMark,
} from "@prismalens/contracts";
import { useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const AUTHOR_WORD: Record<IndexAuthor, string> = {
	you: "You",
	agent: "Agent",
	thread: "Another thread",
	system: "PrismaLens",
};

/** A mark's hover name, e.g. "Usage limit, resets 18:30". */
export function markLabel(mark: RailMark, detail: string | null): string {
	switch (mark) {
		case "compaction":
			return "Context compacted";
		case "usage_limit":
			return detail
				? `Usage limit, resets ${formatClock(detail)}`
				: "Usage limit";
		case "rate_limit":
			return detail === "overloaded" ? "Provider overloaded" : "Rate limited";
		case "auth":
			return "API key rejected";
		case "blocked":
			return detail === "spend_cap" ? "Spend cap reached" : "Out of credit";
		case "restart":
			return "Interrupted by restart";
		case "error":
			return "Error";
		case "report":
			return "Report";
		case "child":
			return detail ? `Child thread ${detail}` : "Child thread finished";
		case "pr":
			return "Pull request linked";
	}
}

/** Shape and tone per mark, told apart without colour alone. */
const MARK_CLASS: Record<RailMark, string> = {
	compaction: "size-2 rotate-45 bg-text-3",
	usage_limit: "h-2 w-3 rounded-[1px] bg-warn",
	rate_limit: "h-1 w-3 rounded-[1px] bg-warn",
	auth: "size-2 rounded-[1px] bg-danger",
	blocked: "h-2 w-3 rounded-[1px] bg-danger",
	restart:
		"size-2 rounded-full bg-transparent outline-2 outline-text-2 outline-solid -outline-offset-2",
	error: "h-0.5 w-3 bg-danger",
	report: "size-1.5 rounded-full bg-live",
	child: "size-1.5 rounded-full bg-text-2",
	pr: "size-1.5 rounded-[1px] bg-text-2",
};

const TICK_WIDTH: Record<IndexAuthor, string> = {
	you: "w-3",
	agent: "w-2",
	thread: "w-1.5",
	system: "w-1.5",
};

export interface RailProps {
	entries: readonly IndexEntry[];
	/** The first and last event keys on screen. */
	range: { first: string | null; last: string | null };
	/** Items with a find hit, and the active one. */
	hits: readonly string[];
	activeHit: string | null;
	onJump: (key: string) => void;
}

/** Where a key sits between the record's first and last seq, 0..1. */
function useSpan(entries: readonly IndexEntry[]) {
	return useMemo(() => {
		const seqs = entries.map((e) => parseEventKey(e[0])?.seq ?? 0);
		const lo = Math.min(...seqs, 0);
		const hi = Math.max(...seqs, lo + 1);
		return (key: string | null) => {
			const seq = key ? parseEventKey(key)?.seq : undefined;
			return seq === undefined ? null : (seq - lo) / (hi - lo);
		};
	}, [entries]);
}

export function TranscriptRail({
	entries,
	range,
	hits,
	activeHit,
	onJump,
}: RailProps) {
	const at = useSpan(entries);
	const [focus, setFocus] = useState(entries.length - 1);
	const [hover, setHover] = useState<number | null>(null);
	const links = useRef<(HTMLAnchorElement | null)[]>([]);
	if (entries.length < 2) return null;

	const first = at(range.first);
	const last = at(range.last);
	const move = (to: number) => {
		const n = Math.max(0, Math.min(entries.length - 1, to));
		setFocus(n);
		links.current[n]?.focus();
	};
	const label = (e: IndexEntry) =>
		e[2]
			? `${markLabel(e[2], e[5])}: ${e[3]}`
			: `${AUTHOR_WORD[e[1]]}: ${e[3]}`;
	const hovered = hover === null ? null : entries[hover];

	return (
		<nav
			aria-label="Thread outline"
			className="pointer-events-none absolute top-3 right-1 bottom-16 z-10 hidden w-5 sm:block"
			data-testid="transcript-rail"
		>
			{first !== null && last !== null && (
				<div
					aria-hidden
					className="absolute right-0 left-0 rounded-sm bg-surface-3/70"
					style={{
						top: `${first * 100}%`,
						height: `max(4px, ${(last - first) * 100}%)`,
					}}
					data-testid="rail-current"
				/>
			)}
			{hits.map((key) => {
				const y = at(key);
				return y === null ? null : (
					<span
						key={`hit-${key}`}
						aria-hidden
						className={cn(
							"absolute left-0 h-0.5 w-1.5 rounded-full",
							key === activeHit ? "bg-warn" : "bg-warn/45",
						)}
						style={{ top: `${y * 100}%` }}
						data-testid={key === activeHit ? "rail-hit-active" : "rail-hit"}
					/>
				);
			})}
			<ol
				className="pointer-events-auto m-0 h-full list-none p-0"
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") move(focus + 1);
					else if (e.key === "ArrowUp") move(focus - 1);
					else if (e.key === "Home") move(0);
					else if (e.key === "End") move(entries.length - 1);
					else return;
					e.preventDefault();
				}}
				onMouseLeave={() => setHover(null)}
			>
				{entries.map((e, i) => {
					const y = at(e[0]);
					if (y === null) return null;
					const seq = parseEventKey(e[0])?.seq;
					return (
						<li
							key={e[0]}
							className={cn("absolute right-0", e[2] && "z-10")}
							style={{ top: `${y * 100}%` }}
						>
							<a
								ref={(el) => {
									links.current[i] = el;
								}}
								href={`#item-${seq}`}
								tabIndex={i === focus ? 0 : -1}
								aria-label={label(e)}
								onFocus={() => {
									setFocus(i);
									setHover(i);
								}}
								onBlur={() => setHover(null)}
								onMouseEnter={() => setHover(i)}
								onClick={(ev) => {
									ev.preventDefault();
									onJump(e[0]);
								}}
								className={cn(
									// The tick is thin; its hit area is the ::after strip around it.
									"relative flex -translate-y-1/2 items-center justify-end rounded-sm outline-none after:absolute after:inset-x-[-4px] after:inset-y-[-4px] after:content-[''] focus-visible:ring-2 focus-visible:ring-accent",
									e[2] ? "h-3 w-4" : "h-1 w-3",
								)}
								data-testid={e[2] ? `rail-mark-${e[2]}` : "rail-tick"}
								data-key={e[0]}
							>
								{e[2] ? (
									<span aria-hidden className={cn("block", MARK_CLASS[e[2]])} />
								) : (
									<span
										aria-hidden
										className={cn(
											"block h-px",
											TICK_WIDTH[e[1]],
											hover === i ? "bg-text-1" : "bg-text-3",
										)}
									/>
								)}
							</a>
						</li>
					);
				})}
			</ol>
			{hovered && (
				<div
					role="tooltip"
					className="absolute right-6 w-64 -translate-y-1/2 rounded-surface bg-surface-1 p-2 text-meta shadow-md"
					style={{ top: `${(at(hovered[0]) ?? 0) * 100}%` }}
					data-testid="rail-preview"
				>
					<p className="font-medium text-text-1">
						{hovered[2]
							? markLabel(hovered[2], hovered[5])
							: AUTHOR_WORD[hovered[1]]}
						<span className="ml-1.5 font-normal text-text-3">
							{hovered[4] ? formatClock(hovered[4]) : ""}
						</span>
					</p>
					<p className="mt-0.5 line-clamp-2 text-text-2">{hovered[3]}</p>
				</div>
			)}
		</nav>
	);
}
