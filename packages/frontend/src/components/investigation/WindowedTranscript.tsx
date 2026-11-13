// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The transcript of a long thread, windowed (#1101 cat 12): virtua renders only
 * the rows near the viewport, pages load at the edges, a prepend keeps the reader
 * where they were, and the list follows the tail only while the reader is at it.
 */
import type { FoldedTurn } from "@prismalens/contracts";
import { compareKeys } from "@prismalens/contracts";
import { ArrowDown, RotateCw, WifiOff } from "lucide-react";
import {
	forwardRef,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { Ring } from "@/components/shared/Ring";
import type { TranscriptItem } from "@/lib/investigation-events";
import { workedLabel } from "@/lib/spine";
import type { Connection } from "@/lib/thread-window/use-thread-window";
import type { EdgeState, WindowChange } from "@/lib/thread-window/window-store";

/** One rendered row; `at` is the event key it shows, for jumps, find and the rail. */
export interface TranscriptRowNode {
	key: string;
	at: string | null;
	node: ReactNode;
	/** Stays mounted off screen, so data it is loading survives windowing (a lead's parent bar). */
	keep?: boolean;
}

export interface TranscriptWindow {
	hasBefore: boolean;
	hasAfter: boolean;
	edges: { before: EdgeState; after: EdgeState };
	change: WindowChange;
	onBefore: () => void;
	onAfter: () => void;
	/** Finished turns sent without their work, by boundary key. */
	folded: ReadonlyMap<string, FoldedTurn>;
	onUnfold: (turnKey: string) => Promise<void>;
	/** Scroll here once its row renders; a new nonce repeats the jump. */
	target: { key: string; nonce: number } | null;
	/** The first and last event keys on screen, for the rail. */
	onRange?: (first: string | null, last: string | null) => void;
	/** Index entries before the loaded window, for the phone's "N earlier". */
	earlier?: number;
	/** Messages in the whole thread, for the "N new" count. */
	messages: number;
	onToTail: () => void;
	connection: Connection;
	/** Live events the record never stored, and events a run could not store. */
	unsaved: number;
	lost: number;
	/** A row's "Show full output", when its events were cut for the page. */
	fullFor?: (item: TranscriptItem) => (() => Promise<void>) | null;
	/** "N new since 14:02" above the first unseen event (#1101 category 3). */
	divider?: { key: string; label: string };
}

/** The event key an item was derived from; null for rows no event made (queued, thinking, end). */
export function itemEventKey(itemKey: string): string | null {
	if (/^(queued|pending)-/.test(itemKey)) return null;
	const k = itemKey.replace(/^(tools|thought|restart|handoff|resumed)-/, "");
	const m = /^(.*)-(\d+)$/.exec(k);
	if (!m) return null;
	return m[1] === "report" ? `report:${m[2]}` : `${m[1]}:${m[2]}`;
}

/** The last row at or before an event key: the row that shows it. */
export function rowIndexOf(
	rows: readonly TranscriptRowNode[],
	key: string,
): number {
	let found = -1;
	for (let i = 0; i < rows.length; i++) {
		const at = rows[i]?.at;
		if (!at) continue;
		if (compareKeys(at, key) <= 0) found = i;
		else break;
	}
	return found;
}

const AT_BOTTOM_PX = 1.5;
const EDGE_PX = 600;

/**
 * virtua's item wrapper is the list item; each row's own items sit in a nested list.
 * The gap lives inside it: virtua measures the item's content box, so padding on
 * the item itself is left out and each row would overlap the one above.
 */
export const Item = forwardRef<
	HTMLLIElement,
	{ style?: React.CSSProperties; children?: ReactNode }
>(function Item({ style, children }, ref) {
	return (
		<li ref={ref} style={style} data-testid="transcript-item">
			<div className="px-4 pt-3">
				<div className="mx-auto w-full max-w-[760px] min-w-0">{children}</div>
			</div>
		</li>
	);
});

export function WindowedTranscript({
	rows,
	win,
	live,
}: {
	rows: TranscriptRowNode[];
	win: TranscriptWindow;
	live: boolean;
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const v = useRef<VirtualizerHandle>(null);
	const atBottom = useRef(true);
	const [away, setAway] = useState(false);
	const wasAway = useRef(false);
	const [seenMessages, setSeenMessages] = useState(win.messages);
	const shift = win.change === "prepend";

	const all: TranscriptRowNode[] = [
		...(win.hasBefore
			? [
					{
						key: "edge-before",
						at: null,
						node: (
							<EdgeRow
								side="before"
								state={win.edges.before}
								onRetry={win.onBefore}
								count={win.earlier}
							/>
						),
					},
				]
			: []),
		...rows,
		...(win.hasAfter
			? [
					{
						key: "edge-after",
						at: null,
						node: (
							<EdgeRow
								side="after"
								state={win.edges.after}
								onRetry={win.onAfter}
							/>
						),
					},
				]
			: []),
	];

	// Read through refs, so reporting the range is one stable function, not one per render.
	const allRef = useRef(all);
	allRef.current = all;
	const onRangeRef = useRef(win.onRange);
	onRangeRef.current = win.onRange;
	const reportRange = useCallback(() => {
		const h = v.current;
		const all = allRef.current;
		const onRange = onRangeRef.current;
		if (!h || !onRange) return;
		const first = h.findItemIndex(h.scrollOffset);
		const last = h.findItemIndex(h.scrollOffset + h.viewportSize);
		const keyAt = (i: number, step: 1 | -1) => {
			for (let j = i; j >= 0 && j < all.length; j += step) {
				const at = all[j]?.at;
				if (at) return at;
			}
			return null;
		};
		onRange(keyAt(first, 1), keyAt(last, -1));
	}, []);

	const onScroll = useCallback(
		(offset: number) => {
			const h = v.current;
			const el = scroller.current;
			if (!h || !el) return;
			// The element's own metrics: virtua's sizes are estimates until rows are measured.
			const bottom =
				el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
			atBottom.current = bottom && !win.hasAfter;
			const nextAway = !atBottom.current;
			// Messages count as new from the moment the reader leaves the bottom.
			if (nextAway !== wasAway.current) {
				wasAway.current = nextAway;
				setSeenMessages(win.messages);
				setAway(nextAway);
			}
			if (offset < EDGE_PX && win.hasBefore && win.edges.before === "idle")
				win.onBefore();
			if (
				el.scrollHeight - offset - el.clientHeight < EDGE_PX &&
				win.hasAfter &&
				win.edges.after === "idle"
			)
				win.onAfter();
		},
		[win],
	);

	// Follow the tail only while the reader is at it. Native scrolling, not
	// scrollToIndex: virtua keeps chasing an index until rows are measured, which on a
	// slow link drags back a reader who has already scrolled away (#1101 cat 12).
	const content = useRef<HTMLDivElement>(null);
	const pin = useCallback(() => {
		const el = scroller.current;
		if (el && atBottom.current && !win.hasAfter) el.scrollTop = el.scrollHeight;
	}, [win.hasAfter]);
	const lastKey = all[all.length - 1]?.key;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new last row or count is what moves the tail.
	useLayoutEffect(() => {
		// In the frame, before its paint: reading the height here in the commit would force a
		// layout of the whole page inside React's task (#1101 category 12).
		const f = requestAnimationFrame(pin);
		return () => cancelAnimationFrame(f);
	}, [all.length, lastKey, pin]);
	useEffect(() => {
		const box = content.current;
		if (!box) return;
		const ro = new ResizeObserver(pin);
		ro.observe(box);
		return () => ro.disconnect();
	}, [pin]);

	// A jump lands its row; instant, since smooth scrollToIndex is unreliable in virtua.
	const target = win.target;
	useLayoutEffect(() => {
		if (!target) return;
		const i = rowIndexOf(all, target.key);
		if (i < 0) return;
		atBottom.current = false;
		v.current?.scrollToIndex(i, { align: "center" });
	}, [target?.nonce, target?.key]);

	// The rows on screen change with the row set; scrolling reports through onScrollEnd.
	useEffect(() => {
		if (all.length > 0 && lastKey) reportRange();
	}, [all.length, lastKey, reportRange]);

	// The reader's position, read on the scroll event itself: a pin queued for the next
	// frame must see a scroll the reader just made, before virtua reports it.
	const hasAfter = win.hasAfter;
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const onNative = () => {
			const bottom =
				el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
			atBottom.current = bottom && !hasAfter;
		};
		el.addEventListener("scroll", onNative, { passive: true });
		return () => el.removeEventListener("scroll", onNative);
	}, [hasAfter]);

	const fresh = Math.max(0, win.messages - seenMessages);
	const dividerKey = win.divider?.key;
	// Before every row (the first unseen thing is an ask in the dock): all of it is new.
	const dividerAt = useMemo(() => {
		if (!dividerKey) return -1;
		const at = rowIndexOf(all, dividerKey);
		return at >= 0 ? at : all.findIndex((r) => !!r.at);
	}, [all, dividerKey]);
	// A row unmounted off screen cancels its own requests; kept rows load once and stay.
	const keepMounted = useMemo(
		() => all.flatMap((r, i) => (r.keep ? [i] : [])),
		[all],
	);
	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div
				ref={scroller}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
				data-testid="transcript-scroller"
				role="log"
				tabIndex={-1}
				aria-busy={
					win.edges.before === "loading" || win.edges.after === "loading"
				}
			>
				<div
					data-testid="transcript"
					data-copy-markdown
					className="[&>ol]:m-0 [&>ol]:list-none [&>ol]:p-0"
				>
					<Virtualizer
						ref={v}
						scrollRef={scroller}
						as="ol"
						item={Item}
						keepMounted={keepMounted}
						shift={shift}
						onScroll={onScroll}
						onScrollEnd={reportRange}
					>
						{all.map((r, i) => (
							<ul
								key={r.key}
								data-at={r.at ?? undefined}
								className="m-0 flex list-none flex-col p-0"
							>
								{i === dividerAt && win.divider && (
									<li>
										<UnseenDivider label={win.divider.label} />
									</li>
								)}
								{r.node}
							</ul>
						))}
					</Virtualizer>
				</div>
				{!win.hasAfter && (win.unsaved > 0 || win.lost > 0) && (
					<p
						className="mx-auto w-full max-w-[760px] px-4 pb-3 text-meta text-text-3"
						data-testid="transcript-incomplete"
					>
						{win.unsaved + win.lost === 1
							? "1 event not saved"
							: `${win.unsaved + win.lost} events not saved`}
					</p>
				)}
			</div>
			{win.connection === "reconnecting" && live && (
				<p
					role="status"
					className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex w-fit items-center gap-1.5 rounded-b-surface bg-surface-2 px-3 py-1 text-meta text-text-2 shadow-sm"
					data-testid="transcript-reconnecting"
				>
					<WifiOff className="size-3.5 text-text-3" aria-hidden />
					Reconnecting…
				</p>
			)}
			{(away || win.hasAfter) && (
				<div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
					<button
						type="button"
						onClick={() => {
							atBottom.current = true;
							wasAway.current = false;
							setAway(false);
							setSeenMessages(win.messages);
							win.onToTail();
							pin();
						}}
						className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-surface-1 px-3 py-1.5 text-meta text-text-1 shadow-md hover:bg-surface-2"
						data-testid={fresh > 0 ? "transcript-new" : "transcript-to-end"}
					>
						<ArrowDown className="size-3.5" aria-hidden />
						{fresh > 0 ? `${fresh} new` : "Scroll to end"}
					</button>
				</div>
			)}
		</div>
	);
}

function EdgeRow({
	side,
	state,
	onRetry,
	count,
}: {
	side: "before" | "after";
	state: EdgeState;
	onRetry: () => void;
	count?: number;
}) {
	const what = side === "before" ? "earlier" : "later";
	return (
		<li
			className="flex min-h-9 items-center justify-center gap-2 text-meta text-text-3"
			data-testid={`transcript-edge-${side}`}
			data-state={state}
		>
			{state === "error" ? (
				<>
					<span role="alert">Couldn't load {what} messages.</span>
					<button
						type="button"
						onClick={onRetry}
						className="inline-flex min-h-6 items-center gap-1 rounded-control px-2 text-text-1 hover:bg-surface-2"
					>
						<RotateCw className="size-3.5" aria-hidden />
						Retry
					</button>
				</>
			) : state === "idle" && count ? (
				<>
					<span className="max-md:hidden"> </span>
					{/* Scrolling up loads them too; a phone gets a control to tap (#1101 category 5). */}
					<button
						type="button"
						onClick={onRetry}
						className="inline-flex min-h-11 items-center rounded-control px-3 text-text-1 hover:bg-surface-2 md:hidden"
						data-testid="transcript-earlier"
					>
						{count} earlier
					</button>
				</>
			) : (
				<span>{state === "loading" ? `Loading ${what} messages…` : " "}</span>
			)}
		</li>
	);
}

/** A finished turn the page sent without its work; opening it reads the turn. */
export function RemoteFoldToggle({
	fold,
	onOpen,
}: {
	fold: FoldedTurn;
	onOpen?: (turnKey: string) => Promise<void>;
}) {
	const [state, setState] = useState<"idle" | "loading" | "error">("idle");
	return (
		<li>
			<button
				type="button"
				aria-expanded={false}
				disabled={state === "loading"}
				onClick={() => {
					setState("loading");
					onOpen?.(fold.turnKey).then(
						() => setState("idle"),
						() => setState("error"),
					);
				}}
				className={TOOL_LINE}
				data-testid="turn-fold-remote"
			>
				<span className="truncate">
					{workedLabel(fold.seconds, fold.steps)}
				</span>
				{fold.failed > 0 && (
					<span className="shrink-0 text-danger">{fold.failed} failed</span>
				)}
				{state === "loading" && <Ring className="size-3.5" />}
				{state === "error" && (
					<span className="shrink-0 text-danger">Couldn't load. Retry</span>
				)}
				<ToolLineChevron open={false} />
			</button>
		</li>
	);
}

/** Output a page shortened; one click reads the events whole. */
export function ShowFull({ onShow }: { onShow: () => Promise<void> }) {
	const [state, setState] = useState<"idle" | "loading" | "error">("idle");
	return (
		<li className="pl-[22px]">
			<button
				type="button"
				disabled={state === "loading"}
				onClick={() => {
					setState("loading");
					onShow().then(
						() => setState("idle"),
						() => setState("error"),
					);
				}}
				className="min-h-6 text-meta text-text-3 hover:text-text-1"
				data-testid="show-full-output"
			>
				{state === "loading"
					? "Loading the full output…"
					: state === "error"
						? "Couldn't load the full output. Retry"
						: "Show full output"}
			</button>
		</li>
	);
}

/** Where the unseen part of a thread starts, with how much is new and since when. */
export function UnseenDivider({ label }: { label: string }) {
	return (
		<div
			className="mb-3 flex items-center gap-3 text-meta font-medium text-accent"
			data-surface="transcript.unseen"
			data-testid="unseen-divider"
		>
			<span className="h-px flex-1 bg-accent/40" aria-hidden />
			<span>{label}</span>
			<span className="h-px flex-1 bg-accent/40" aria-hidden />
		</div>
	);
}
