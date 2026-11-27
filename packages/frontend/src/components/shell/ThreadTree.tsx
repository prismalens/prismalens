// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	isWorkflowLive,
	type ThreadRow,
	type ThreadStatus,
	type ThreadStatusInfo,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowUp,
	ChevronRight,
	MessageSquareReply,
	MoreHorizontal,
} from "lucide-react";
import {
	createContext,
	type KeyboardEvent,
	memo,
	type ReactElement,
	type ReactNode,
	type Ref,
	type RefObject,
	useCallback,
	useContext,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "react";
import { causeOf } from "@/components/home/needs-cause";
import { fact } from "@/components/kit/fact";
import { Mark, StartedByMark } from "@/components/kit/MarkBadges";
import { markLook } from "@/components/kit/marks";
import { relTime } from "@/components/kit/rel-time";
import {
	fixActionId,
	Status,
	type StatusKind,
	statusIcon,
	statusText,
	statusTint,
	statusWord,
} from "@/components/kit/Status";
import { startedByUser } from "@/components/run/trigger-types";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import {
	type RowAskEntry,
	useAnswerNote,
	useRowAsk,
} from "@/components/shell/RowAsk";
import { RowBadges } from "@/components/shell/RowBadges";
import {
	RowBranch,
	RowLines,
	RowPlace,
	useRest,
} from "@/components/shell/RowLines";
import { useMediaQuery } from "@/hooks/use-media-query";
import { askSubject, whyAsked } from "@/lib/ask-lines";
import { lazyPart, useAfterFirstContent } from "@/lib/lazy";
import type { Destination } from "@/lib/thread-hold";
import {
	type ListNode,
	recedes,
	type ThreadListModel,
} from "@/lib/thread-list";
import { rowLine, threadLink } from "@/lib/thread-rows";
import {
	ageWord,
	elapsedWord,
	infoReason,
	type ReasonToken,
	rowReason,
	rowSettled,
	statusReason,
} from "@/lib/thread-status";
import { readableTitle } from "@/lib/title";
import { toolTitle } from "@/lib/tool-title";
import { cn } from "@/lib/utils";

// A row's ⋯ menu and right-click menu are not on screen at first paint, so their code
// loads after it (#1101 category 12); the ⋯ stays disabled until then, so no click is lost.
const ThreadMenu = lazyPart(
	() => import("@/components/shell/ThreadMenu").then((m) => m.ThreadMenu),
	() => (
		<button
			type="button"
			aria-label="Thread actions"
			disabled
			className="flex size-6 items-center justify-center rounded-control text-text-2"
			data-testid="thread-menu"
		>
			<MoreHorizontal className="size-3.5" aria-hidden />
		</button>
	),
);
const ThreadContextMenu = lazyPart(
	() =>
		import("@/components/shell/ThreadMenu").then((m) => m.ThreadContextMenu),
	(p: { children: ReactElement }) => p.children,
);

// A row's peek and ask card load when one opens (#1101 category 12).
const RowCard = lazyPart(
	() => import("./RowCard").then((m) => m.RowCard),
	null,
	{
		now: true,
	},
);
// Its preview and the settle words load after the list draws; the actions show on hover.
const RowSettle = lazyPart(
	() => import("./RowSettle").then((m) => m.RowSettle),
	null,
	{ afterFirstContent: true },
);
// The field loads when a rename starts.
const RenameField = lazyPart(
	() => import("./RenameField").then((m) => m.RenameField),
	null,
	{ now: true },
);
const RowPeek = lazyPart(() => import("./RowPeek").then((m) => m.Peek), null, {
	now: true,
});
// An ask's card body loads with the card, never with the list (entry-budget.json).
const RowAsk = lazyPart(
	() => import("./RowAskCard").then((m) => m.RowAsk),
	null,
	{ now: true },
);
const preloadCard = () => {
	void RowCard.preload(true);
	void RowPeek.preload(true);
	void RowAsk.preload(true);
};

/**
 * Whether a row reads as unread (bold title). The list's default is the feed's
 * `unseen`; the read-state lane feeds its server-synced answer through this seam.
 */
export const RowUnread = createContext<(t: ThreadRow) => boolean>(
	(t) => t.unseen,
);

/** Rows and settled rows shown before "Show N more". */
const ROWS_SHOWN = 15;
const SETTLED_SHOWN = 10;
/** Rows the first frame draws, about a screenful; the rest mount after the page's first content (#1130). */
const FIRST_FRAME_ROWS = 16;

/** One status as a shape in its colour, the word for screen readers (#1101 category 2 item 1). */
export function StatusMark({
	status,
	className,
}: {
	status: ThreadStatus;
	className?: string;
}) {
	const Icon = statusIcon(status);
	if (!Icon)
		return (
			<span
				className={cn("flex size-4 items-center justify-center", className)}
			>
				<Ring className="text-accent" />
			</span>
		);
	return (
		<Icon
			aria-hidden
			className={cn(
				"size-3.5 shrink-0 stroke-[1.75]",
				statusTint(status),
				className,
			)}
		/>
	);
}

/**
 * A thread's status as its shape and word, with the reason on hover, for every
 * surface outside the list (the header, the panel roster, schedule runs).
 */
export function StatusLabel({
	info,
	now,
	className,
	kind = info.status,
}: {
	info: ThreadStatusInfo;
	now: number;
	className?: string;
	/** The kit kind drawn, when it is not the server's status: a settled thread. */
	kind?: StatusKind;
}) {
	const reason = infoReason(info, now);
	return (
		<Hint label={reason ?? statusWord(kind)} when={!!reason}>
			{/* The kit's Status: one icon, colour and word for a state everywhere (sheet §0.6). */}
			<span
				className={cn("inline-flex min-w-0 items-center", className)}
				data-testid="status-label"
				data-state={kind}
			>
				<Status kind={kind} word={statusWord(kind)} />
				{reason && <span className="sr-only">, {reason}</span>}
			</span>
		</Hint>
	);
}

/** Only the icon carries colour (sheet §9.1); a word that needs you reads at full strength. */
export const wordTone = (s: ThreadStatus) => statusText(s);

/** The title a row shows: an alert's run reads as its incident; any other thread by its own title. */
function rowTitle(n: ListNode): string {
	const chip = n.unit.incident;
	if (chip && !startedByUser(n.thread.triggerType))
		return readableTitle(chip.title);
	return (
		n.thread.title?.trim() ||
		chip?.title ||
		(n.thread.kind === "chat" ? "Thread" : "Run")
	);
}

/** The detail line: the status reason, else the live step, the answer or the cause. */
export function detailLine(
	n: ListNode,
	now: number,
	ask?: RowAskEntry,
): string | null {
	// An ask row says what is asked; its age is the row's own time mark (#1101 cat 8 item 1).
	if (ask) return askSubject(ask.ask) ?? toolTitle(ask.ask.title);
	// Times read relative, as everywhere: "Resumes in 2h" (#1101 cat 3).
	return (
		statusReason(n.thread, n.info, now, (iso) => relTime(iso, now)) ??
		rowLine(n.thread)
	);
}

export interface TreeProps {
	model: ThreadListModel;
	/** Open asks by thread, oldest first. */
	asks: ReadonlyMap<string, RowAskEntry[]>;
	now: number;
	currentId: string | null;
	onSettle?: (t: ThreadRow) => void;
	/** The settled group's rows beyond what loaded. */
	onMoreSettled?: () => void;
	/** Threads past what loaded: the server's count, and a fetch for the next page. */
	activeTotal?: number;
	/** Feed pages loaded: a page that brings no Threads row still asks for the next. */
	pages?: number;
	onMoreActive?: () => void;
	/** The feed holds another page: with no total, Show more stays, unnumbered, until the last. */
	hasMoreActive?: boolean;
	/** Every row open and the settled group shown: the design gallery's frames. */
	expandAll?: boolean;
	/** Rows not matching a filter are left out. */
	filter?: (n: ListNode) => boolean;
	/** A control on the Threads heading: the sidebar's started-by toggle. */
	threadsAction?: ReactNode;
	/** Rows held where the reader saw them though the live list moved them (#1247 D25). */
	moving?: ReadonlyMap<string, Destination>;
	/** Needs you unfiltered while a filter narrows the rest, and the control that asks for it. */
	needsAll?: boolean;
	onShowAllNeeds?: () => void;
	/** Needs-you rows past what loaded: they come first in the feed, so the next page brings them. */
	onMoreNeeds?: () => void;
	children?: ReactNode;
}

/**
 * The thread list (#1101 category 1): Needs you on top with its full count, pinned
 * threads, every other thread flat with its started-by mark, and Settled folded at
 * the foot. Visual order is DOM order, so j/k and Tab follow it.
 */
export function ThreadTreeView({
	model,
	asks,
	now,
	currentId,
	onSettle,
	onMoreSettled,
	activeTotal,
	pages,
	onMoreActive,
	hasMoreActive,
	expandAll = false,
	filter,
	threadsAction,
	moving,
	needsAll = false,
	onShowAllNeeds,
	onMoreNeeds,
	children,
}: TreeProps) {
	const [settledOpen, setSettledOpen] = useStoredOpen(
		SETTLED_OPEN_KEY,
		expandAll,
	);
	const needsHead = useRef<HTMLHeadingElement>(null);
	const [rowsShown, setRowsShown] = useState(ROWS_SHOWN);
	const [settledShown, setSettledShown] = useState(SETTLED_SHOWN);
	// Rows are memoised (`sameRow`); Settle reaches them through one stable callback.
	const settleNow = useRef(onSettle);
	settleNow.current = onSettle;
	const settle = useCallback((t: ThreadRow) => settleNow.current?.(t), []);
	const keep = (n: ListNode): boolean => !filter || filter(n);
	// Counted in DOM order as the sections below call it: the first rows draw now, the rest later.
	let budget =
		useAfterFirstContent() || expandAll
			? Number.POSITIVE_INFINITY
			: FIRST_FRAME_ROWS;
	const rows = (n: ListNode, inNeeds = false, all = false): ReactNode[] =>
		(all || keep(n)) && budget-- > 0
			? [
					<ListRow
						key={n.id}
						node={n}
						now={now}
						on={currentId === n.id}
						asks={asks.get(n.id) ?? NO_ASKS}
						onSettle={onSettle ? settle : undefined}
						inNeeds={inNeeds}
						moving={moving?.get(n.id)}
					/>,
				]
			: [];
	// A filter never strands Needs you: it says how many match, and Show all lists the rest (#1247 D25).
	const needsFiltered = !!filter && !needsAll;
	const needs = needsFiltered ? model.needs.filter(keep) : model.needs;
	const needsLeft = needsFiltered ? 0 : model.needsCount - model.needs.length;
	const active = model.active.filter(keep);
	const settledRows = model.settled.filter(keep);
	// Rows past the loaded pages count too, so "Show N more" stays until the last (#1101 cat 1.5).
	const activeLeft =
		Math.max(active.length, filter ? 0 : (activeTotal ?? 0)) - rowsShown;
	const activeUncounted =
		!filter && activeTotal === undefined && !!hasMoreActive;
	// Settled rows sit on the feed's later pages: an open group loads until it can show its count (#1101 cat 1.5).
	const settledWanted = Math.min(settledShown, model.settledCount);
	const settledShort = settledOpen && model.settled.length < settledWanted;
	useEffect(() => {
		if (settledShort) onMoreSettled?.();
	});
	// A Show more pressed while a page loads is dropped by the feed: each page that lands short asks again.
	const moreActive = useRef(onMoreActive);
	moreActive.current = onMoreActive;
	// The loaded count while short of the rows asked for, else -1.
	const shortAt =
		!expandAll &&
		!filter &&
		active.length < Math.min(rowsShown, activeTotal ?? rowsShown)
			? active.length
			: -1;
	// Each page that lands short asks again, one with no Threads row too.
	const shortKey = shortAt >= 0 ? `${shortAt}/${pages ?? 0}` : "";
	useEffect(() => {
		if (shortKey) moreActive.current?.();
	}, [shortKey]);
	// Rows a page or a Show more adds mount from a deferred pass React builds in slices, never
	// inside the task that brought the data (#1101 cat 1.8: no task over 100 ms while scrolling).
	const activeDrawn = useDeferredValue(Math.min(rowsShown, active.length));
	const settledDrawn = useDeferredValue(
		settledOpen ? Math.min(settledShown, settledRows.length) : 0,
	);
	return (
		<div className="flex flex-col gap-3" data-testid="thread-tree">
			{model.needs.length > 0 && (
				<NeedsBar
					head={needsHead}
					count={model.needsCount}
					first={model.needs[0]?.info.status ?? null}
					onGo={() => {
						if (!needs.length) onShowAllNeeds?.();
					}}
				/>
			)}
			{children}
			{model.needs.length > 0 && (
				<Section
					label="Needs you"
					count={model.needsCount}
					matched={needsFiltered ? needs.length : undefined}
					tone="font-medium text-text-1"
					testId="thread-section-needs"
					headRef={needsHead}
					action={
						needsFiltered && onShowAllNeeds ? (
							<button
								type="button"
								onClick={onShowAllNeeds}
								className="ml-1.5 rounded-control px-1 font-medium text-accent hover:bg-surface-3"
								data-testid="needs-show-all"
							>
								Show all
							</button>
						) : undefined
					}
				>
					{needs.flatMap((n) => rows(n, true, true))}
					{!expandAll && needsLeft > 0 && onMoreNeeds && (
						<MoreButton
							n={needsLeft}
							onClick={onMoreNeeds}
							testId="needs-show-more"
						/>
					)}
				</Section>
			)}
			{model.pinned.filter(keep).length > 0 && (
				<Section label="Pinned" testId="thread-section-pinned">
					{model.pinned.flatMap((n) => rows(n))}
				</Section>
			)}
			<Section
				label="Threads"
				testId="thread-section-threads"
				action={threadsAction}
			>
				{active.length === 0 ? (
					<p
						className="px-2.5 py-1 text-body text-text-3"
						data-testid="threads-empty"
					>
						{filter ? "No threads match" : "Nothing running"}
					</p>
				) : (
					active
						.slice(0, expandAll ? undefined : activeDrawn)
						.flatMap((n) => rows(n))
				)}
				{!expandAll && (activeLeft > 0 || activeUncounted) && (
					<MoreButton
						n={activeUncounted ? undefined : activeLeft}
						onClick={() => {
							setRowsShown((v) => v + 25);
							if (active.length < rowsShown + 25) onMoreActive?.();
						}}
						testId="threads-show-more"
					/>
				)}
			</Section>
			{/* A held list can keep a row here that the live list has moved out (#1247 D25). */}
			{(model.settledCount > 0 || model.settled.length > 0) && (
				<section
					aria-label="Settled"
					className="flex flex-col gap-px"
					data-testid="thread-section-settled"
				>
					<button
						type="button"
						aria-expanded={settledOpen}
						onClick={() => setSettledOpen((o) => !o)}
						className="flex h-7 items-center gap-1.5 rounded-control px-2.5 text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
						data-testid="settled-toggle"
					>
						<ChevronRight
							aria-hidden
							className={cn(
								"size-3 transition-transform",
								settledOpen && "rotate-90",
							)}
						/>
						Settled
						<span className="ml-auto tabular-nums">{model.settledCount}</span>
					</button>
					{settledOpen && (
						<>
							{settledRows.slice(0, settledDrawn).flatMap((n) => rows(n))}
							{model.settledCount > settledShown && (
								<MoreButton
									n={model.settledCount - settledShown}
									onClick={() => {
										setSettledShown((v) => v + 25);
										onMoreSettled?.();
									}}
									testId="settled-show-more"
								/>
							)}
						</>
					)}
				</section>
			)}
		</div>
	);
}

function Section({
	label,
	count,
	matched,
	tone,
	testId,
	action,
	headRef,
	children,
}: {
	label: string;
	count?: number;
	/** With a filter on, how many of `count` match it. */
	matched?: number;
	tone?: string;
	testId: string;
	/** One control at the heading's end, such as the started-by toggle. */
	action?: ReactNode;
	headRef?: Ref<HTMLHeadingElement>;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={label}
			className="flex flex-col gap-px"
			data-testid={testId}
		>
			<h2
				ref={headRef}
				className="flex h-7 items-center px-2.5 text-meta text-text-3"
			>
				{label}
				{count !== undefined && (
					<span
						className={cn("ml-auto tabular-nums", tone)}
						data-testid={`${testId}-count`}
					>
						{matched === undefined ? count : `${matched} of ${count}`}
					</span>
				)}
				{action && (
					<span className={cn("flex", count === undefined && "ml-auto")}>
						{action}
					</span>
				)}
			</h2>
			{children}
		</section>
	);
}

function MoreButton({
	n,
	onClick,
	testId,
}: {
	/** Absent when the count is unknown. */
	n?: number;
	onClick: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-7 items-center rounded-control px-2.5 text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
			data-testid={testId}
		>
			{n === undefined ? "Show more" : `Show ${n} more`}
		</button>
	);
}

const NO_ASKS: RowAskEntry[] = [];

/**
 * A row redraws only when what it shows changed: a feed or ask refresh redraws the list in
 * one synchronous pass, which took over a second on a slowed CPU with 50 rows (#1101 cat 1.8).
 */
function sameRow(a: RowProps, b: RowProps): boolean {
	if (
		a.now !== b.now ||
		a.on !== b.on ||
		a.inNeeds !== b.inNeeds ||
		a.moving !== b.moving ||
		!a.onSettle !== !b.onSettle ||
		a.asks.length !== b.asks.length ||
		a.asks.some((e, i) => e !== b.asks[i])
	)
		return false;
	const x = a.node;
	const y = b.node;
	if (x === y) return true;
	if (x.thread !== y.thread || x.unit !== y.unit || x.at !== y.at) return false;
	// The status info is rebuilt each pass with nested parts (a limit, what it waits on).
	return JSON.stringify(x.info) === JSON.stringify(y.info);
}

type RowProps = {
	askOpenAtStart?: boolean;
	node: ListNode;
	now: number;
	on: boolean;
	asks: RowAskEntry[];
	onSettle?: (t: ThreadRow) => void;
	/** In the Needs you group, which already says why: the icon is enough. */
	inNeeds?: boolean;
	/** Held where the reader saw it; where it goes once they leave the list. */
	moving?: Destination;
};

const ListRow = memo(ListRowView, sameRow);

function ListRowView({
	node,
	now,
	on,
	asks,
	onSettle,
	inNeeds = false,
	askOpenAtStart = false,
	moving,
}: RowProps) {
	const unread = useContext(RowUnread)(node.thread);
	const navigate = useNavigate();
	// One card beside the row (sheet §1): the ask when it waits, else the peek.
	const [peek, setPeek] = useState(false);
	const [askOpen, setAskOpen] = useState(askOpenAtStart);
	const roomy = useMediaQuery("(min-width: 640px)");
	const [renaming, setRenaming] = useState(false);
	const entry = asks[0];
	const ask = useRowAsk(entry);
	const answerNote = useAnswerNote(node.id, entry?.ask.askId ?? null);
	const title = rowTitle(node);
	const link = threadLink(node.thread);
	const mark = node.info.status;
	const detail = detailLine(node, now, entry);
	const t = node.thread;
	const by = t.startedBy ?? null;
	const quiet = recedes(node) && !on;
	const settleable =
		!isWorkflowLive(t.status) &&
		// The thread's own section, as its menu reads it: an incident's unit can mix both (#1101 cat 2.2).
		!rowSettled(t) &&
		node.info.status !== "approval" &&
		node.info.status !== "question";
	const open = () => void navigate(link);
	const onKey = (e: KeyboardEvent) => {
		if (
			e.target !== e.currentTarget.querySelector('[data-testid="thread-row"]')
		)
			return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === " ") {
			e.preventDefault();
			if (asking) setAskOpen((o) => !o);
			else setPeek((p) => !p);
		} else if (e.key === "Escape" && (peek || askOpen)) {
			e.preventDefault();
			setPeek(false);
			setAskOpen(false);
		} else if (entry && (e.key === "y" || e.key === "Y")) {
			e.preventDefault();
			ask.approve();
		} else if (entry && (e.key === "n" || e.key === "N")) {
			e.preventDefault();
			ask.decline();
		} else if (entry && /^[1-9]$/.test(e.key) && ask.pick(Number(e.key))) {
			e.preventDefault();
		}
	};
	// An ask row opens its ask card even before the ask itself has loaded on a slow link.
	const asking =
		!!entry || (inNeeds && (mark === "approval" || mark === "question"));
	const fixId = inNeeds ? rowFixId(node) : null;
	const cardOpen = asking ? askOpen : peek;
	// An ask row's wait and why it asked: in the rest card, and always to screen readers (#1020).
	const more =
		inNeeds && entry
			? [
					`Waiting ${elapsedWord(Math.max(0, now - Date.parse(entry.ask.openedAt)))}`,
					whyAsked(entry.ask, entry.accessLevel),
					asks.length > 1 && `${asks.length} asks, oldest first`,
				]
					.filter(Boolean)
					.join(" · ")
			: null;
	// Resting on the row opens its card; resting on its PR badge, only the PR list (#1020).
	const rest = useRest(450);
	const prRest = useRest(150);
	const rowBox = useRef<HTMLDivElement>(null);
	if (renaming)
		return (
			<RenameField id={t.id} title={title} onDone={() => setRenaming(false)} />
		);
	// The row's one time: elapsed while Working, the reset while Limited, else its age (sheet §1).
	const running = mark === "working";
	const since = running && t.startedAt ? Date.parse(t.startedAt) : Number.NaN;
	const slotTime =
		running && !Number.isNaN(since) && now
			? // One unit fits the time column; the hint has the exact start.
				elapsedWord(now - since).split(" ")[0]
			: mark === "limited" && t.limit?.resetsAt && now
				? relTime(t.limit.resetsAt, now)
				: now
					? ageWord(node.at, now)
					: null;
	// The slot's moment, exact in the title's hint: the start, the reset or the last activity.
	const slotAt =
		running && !Number.isNaN(since)
			? since
			: mark === "limited" && t.limit?.resetsAt
				? Date.parse(t.limit.resetsAt)
				: node.at || null;
	// Status and time sit in the top corner; the status says itself by its icon (#1020).
	const corner = (
		<>
			<span
				role="img"
				aria-label={statusWord(mark)}
				className="flex shrink-0"
				{...fact("status")}
			>
				<StatusMark status={mark} />
			</span>
			<time
				dateTime={slotAt ? new Date(slotAt).toISOString() : undefined}
				className={cn(
					"whitespace-nowrap text-right text-meta tabular-nums",
					running ? "text-accent" : "text-text-3",
				)}
				data-testid="row-age"
				{...fact("activity")}
			>
				{slotTime}
			</time>
		</>
	);
	const cause = inNeeds && detail;
	const reason = inNeeds
		? null
		: rowReason(t, node.info, now, (iso) => relTime(iso, now));
	// The meta line leads with the starter, then where a held row goes, or its reason and branch.
	const lead = (
		<>
			{/* A click on the mark opens the starter; the row's link opens the row (#1101 cat 10). */}
			{by && (
				<span className="flex w-3.5 shrink-0" data-starter={by.id}>
					<StartedByMark by={by} />
				</span>
			)}
			{/* A held row says where it goes once the reader leaves the list (#1247 D25). */}
			{moving ? (
				<span
					className="min-w-0 flex-1 truncate text-accent"
					data-testid="row-moving"
				>
					{MOVES[moving]}
				</span>
			) : reason && !reason.mark ? (
				<span className="min-w-0 flex-1 truncate" data-testid="row-detail">
					{reason.words}
				</span>
			) : (
				<>
					{reason?.mark && <ReasonMark reason={reason} />}
					<RowBranch t={t} />
				</>
			)}
		</>
	);
	const closeRest = () => {
		rest.leave();
		prRest.leave();
	};
	return (
		<ThreadContextMenu
			thread={t}
			onRename={() => setRenaming(true)}
			{...(onSettle ? { onSettle: () => onSettle(t) } : {})}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the row's keys act on the focused link inside. */}
			<div
				className="group/row relative"
				data-testid="thread-row-wrap"
				// An open card keeps the list still (use-list-hold).
				data-card-open={cardOpen || undefined}
				data-moving={moving}
				onKeyDown={onKey}
				// The card's code loads as the row is reached, so Space opens it at once (#1101 cat 1).
				// Rows passing under a still pointer only arm a timer, so a scrolling list never redraws (#1101 bar 1.8).
				onPointerEnter={(e) => {
					preloadCard();
					if (e.pointerType === "mouse" && rowBox.current)
						rest.enter(rowBox.current);
				}}
				onFocus={preloadCard}
				onPointerLeave={closeRest}
			>
				<div className="flex items-stretch" ref={rowBox}>
					<Link
						{...link}
						onClick={(e) => {
							const el = e.target as Element;
							if (by && el.closest?.("[data-starter]")) {
								e.preventDefault();
								void navigate({ to: "/threads/$id", params: { id: by.id } });
								return;
							}
							// A click or tap on an ask row opens its ask; a modified click still opens the thread (#1101 cat 8.2).
							if (
								asking &&
								!(e.metaKey || e.ctrlKey || e.shiftKey || e.button)
							) {
								e.preventDefault();
								setAskOpen((o) => !o);
							}
						}}
						aria-current={on ? "page" : undefined}
						aria-description={more ?? undefined}
						aria-keyshortcuts={entry ? "Y N Space" : "Space"}
						className={cn(
							// The scroll margin keeps a focused row clear of the Needs you bar.
							"flex min-w-0 flex-1 scroll-mt-8 flex-col justify-center gap-0.5 rounded-control py-1.5 pr-2 pl-2.5 text-text-2 max-sm:min-h-11 transition-colors duration-(--dur-instant) hover:bg-surface-2 focus-visible:bg-surface-3",
							on && "bg-surface-3 hover:bg-surface-3",
						)}
						data-testid="thread-row"
						data-list-row
						data-id={t.id}
						// The slow-link census reads how stale the row is (#1181).
						data-activity={Date.parse(t.lastActivityAt)}
						data-state={mark}
						data-started-by={by?.via}
						data-quiet={quiet || undefined}
					>
						<RowLines
							place={<RowPlace t={t} />}
							corner={corner}
							title={
								<span
									dir="auto"
									className={cn(
										// The hover actions sit at the title line's end; the title ends before them.
										"min-w-0 truncate text-body group-hover/row:pr-[4.5rem] group-has-[:focus-visible]/row:pr-[4.5rem]",
										// Unread is the bold title; the status icon is the row's only coloured mark (#1101).
										unread
											? "font-semibold text-text-1"
											: quiet
												? "text-text-3"
												: "text-text-1",
									)}
									data-testid="row-title"
									{...fact("title")}
								>
									{title}
								</span>
							}
							cause={
								cause ? (
									<span
										className="min-w-0 truncate text-meta text-text-3"
										data-testid="row-cause"
										{...fact("cause")}
									>
										{detail}
									</span>
								) : null
							}
							lead={lead}
							badges={
								<RowBadges
									t={t}
									alerts={node.unit.incident?.alertCount}
									onPrEnter={(el) => {
										rest.leave();
										prRest.enter(el);
									}}
									onPrLeave={() => {
										prRest.leave();
										if (rowBox.current) rest.enter(rowBox.current);
									}}
								/>
							}
						/>
					</Link>
				</div>

				{cardOpen && (
					<RowCard
						anchor={rowBox}
						side={roomy ? "right" : "bottom"}
						label={asking ? "Waiting ask" : title}
						testId={asking ? "row-ask-card" : "row-peek"}
						onClose={() => {
							setPeek(false);
							setAskOpen(false);
						}}
					>
						{entry ? (
							<RowAsk
								state={ask}
								ended={entry.ended}
								accessLevel={entry.accessLevel}
								now={now}
								count={asks.length}
								openHref={open}
							/>
						) : asking ? (
							<p className="text-meta text-text-3" aria-busy>
								Loading the ask
							</p>
						) : (
							<RowPeek node={node} now={now} title={title} more={more} />
						)}
					</RowCard>
				)}
				{!cardOpen && (rest.at || prRest.at) && (
					<RowCard
						anchor={prRest.at ? { current: prRest.at } : rowBox}
						side={prRest.at || !roomy ? "bottom" : "right"}
						label={title}
						testId={prRest.at ? "row-pr-list" : "row-rest-card"}
						passive
						onClose={closeRest}
					>
						<RowPeek
							node={node}
							now={now}
							title={title}
							more={more}
							{...(prRest.at ? { only: "prs" as const } : {})}
						/>
					</RowCard>
				)}
				<div
					className={cn(
						"absolute top-[1.375rem] right-1 hidden items-center group-hover/row:flex group-has-[:focus-visible]/row:flex focus-within:flex has-[[data-state=open]]:flex",
					)}
					data-row-actions
				>
					{entry && (
						<Hint label="Answer" keys={["Space"]}>
							<button
								type="button"
								aria-label="Answer"
								aria-expanded={askOpen}
								onClick={() => setAskOpen((o) => !o)}
								className="flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
								data-testid="row-answer"
							>
								<MessageSquareReply className="size-3.5" aria-hidden />
							</button>
						</Hint>
					)}
					{onSettle && settleable && (
						<RowSettle id={t.id} onSettle={() => onSettle(t)} />
					)}
					<ThreadMenu
						thread={t}
						where="row"
						onRename={() => setRenaming(true)}
						{...(onSettle ? { onSettle: () => onSettle(t) } : {})}
					/>
				</div>
				{inNeeds && !asking && fixId && (
					// A held row's fix may no longer apply: it keeps its room, out of reach.
					<div className={cn(moving && "invisible")}>
						<RowFix node={node} id={fixId} />
					</div>
				)}
				{!entry && answerNote && (
					<p
						className="pb-1.5 text-meta text-text-2"
						style={{ paddingLeft: 30 }}
						data-testid={
							answerNote === "here" ? "row-ask-answered" : "row-ask-elsewhere"
						}
					>
						{answerNote === "here" ? "Answered" : "Answered on another device"}
					</p>
				)}
			</div>
		</ThreadContextMenu>
	);
}

const MOVES: Record<Destination, string> = {
	needs: "Moves to Needs you",
	pinned: "Moves to Pinned",
	active: "Moves to Threads",
	settled: "Moves to Settled",
	gone: "Leaves the list",
};

const SETTLED_OPEN_KEY = "pl.threads.settledOpen";

/** A fold this device remembers; a browser that refuses storage keeps it for the visit. */
function useStoredOpen(
	key: string,
	initial: boolean,
): [boolean, (next: (open: boolean) => boolean) => void] {
	const [open, setOpen] = useState(initial);
	useEffect(() => {
		if (initial) return;
		try {
			setOpen(localStorage.getItem(key) === "1");
		} catch {
			// No storage: the fold starts closed.
		}
	}, [key, initial]);
	const set = (next: (open: boolean) => boolean) =>
		setOpen((o) => {
			const v = next(o);
			try {
				localStorage.setItem(key, v ? "1" : "0");
			} catch {
				// No storage: the fold lasts this visit.
			}
			return v;
		});
	return [open, set];
}

const scrollParent = (el: HTMLElement): HTMLElement | null => {
	for (let p = el.parentElement; p; p = p.parentElement)
		if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
	return null;
};

/**
 * Needs you's heading, kept at the top of the list once the real one scrolls away (#1247 D25):
 * the full count stays on screen, and a click goes back to the first waiting row. It takes
 * no room, so nothing shifts as it appears; rows keep clear of it by their scroll margin.
 */
function NeedsBar({
	head,
	count,
	first,
	onGo,
}: {
	head: RefObject<HTMLHeadingElement | null>;
	count: number;
	first: ThreadStatus | null;
	/** Runs before the jump: Show all, when a filter left no row to go to. */
	onGo: () => void;
}) {
	const [off, setOff] = useState(false);
	useEffect(() => {
		const h = head.current;
		const scroller = h && scrollParent(h);
		if (!h || !scroller) return;
		const check = () =>
			setOff(
				h.getBoundingClientRect().bottom <=
					scroller.getBoundingClientRect().top + 1,
			);
		check();
		scroller.addEventListener("scroll", check, { passive: true });
		window.addEventListener("resize", check);
		return () => {
			scroller.removeEventListener("scroll", check);
			window.removeEventListener("resize", check);
		};
	}, [head]);
	const go = () => {
		onGo();
		requestAnimationFrame(() => {
			const h = head.current;
			h?.scrollIntoView({ block: "start" });
			h?.parentElement
				?.querySelector<HTMLElement>('[data-testid="thread-row"]')
				?.focus({ preventScroll: true });
		});
	};
	return (
		<div className="sticky top-0 z-[5] h-0">
			{off && (
				<button
					type="button"
					onClick={go}
					aria-label={`Needs you, ${count}. Go to the first`}
					className="absolute inset-x-0 top-0 flex h-7 items-center gap-1.5 rounded-control bg-surface-1 px-2.5 text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
					data-testid="needs-bar"
				>
					{first && <StatusMark status={first} />}
					Needs you
					<span
						className="ml-auto font-medium text-text-1 tabular-nums"
						data-testid="needs-bar-count"
					>
						{count}
					</span>
					<ArrowUp aria-hidden className="size-3" />
				</button>
			)}
		</div>
	);
}

/** A needs-you row's registered fix beyond opening it, as Home's card offers it (#1193). */
function rowFixId(node: ListNode) {
	const id = fixActionId(node.info.status, causeOf(node));
	return id && id !== "needs.open" && id !== "needs.answer" ? id : null;
}

/** The registry loads behind the row, not with the shell's first paint (entry-budget.json). */
const RowFix = lazyPart(
	() => import("./RowFix").then((m) => m.RowFix),
	() => (
		<div className="flex pb-1.5">
			<div className="min-h-6" />
		</div>
	),
	{ afterFirstContent: true },
);

/** A reason with a shape: its icon and token, the sentence in its hint and accessible name. */
function ReasonMark({ reason }: { reason: ReasonToken }) {
	const look = markLook("reason", reason.mark);
	return (
		<span className="flex shrink-0 text-text-3" data-reason={reason.mark}>
			<Mark label={reason.words} testId="row-detail">
				<look.icon
					aria-hidden
					className={cn("size-3 shrink-0", look.className)}
				/>
				{reason.token && <span>{reason.token}</span>}
			</Mark>
		</span>
	);
}
