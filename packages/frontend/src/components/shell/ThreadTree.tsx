// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	agentName,
	isWorkflowLive,
	lastPlainLine,
	type ThreadRow,
	type ThreadStatus,
	type ThreadStatusInfo,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight, MessageSquareReply } from "lucide-react";
import {
	createContext,
	type KeyboardEvent,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "react";
import { fact } from "@/components/kit/fact";
import {
	AgentBadge,
	BranchMark,
	PrMark,
	StartedByMark,
	startedByLabel,
} from "@/components/kit/MarkBadges";
import { relTime } from "@/components/kit/rel-time";
import {
	Status,
	type StatusKind,
	statusIcon,
	statusShort,
	statusText,
	statusTint,
	statusWord,
} from "@/components/kit/Status";
import { startedByUser } from "@/components/run/trigger-types";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { RenameField } from "@/components/shell/RenameField";
import {
	RowAsk,
	type RowAskEntry,
	useAnswerNote,
	useRowAsk,
} from "@/components/shell/RowAsk";
import { ThreadContextMenu, ThreadMenu } from "@/components/shell/ThreadMenu";
import { GitStateMark } from "@/components/thread/git/GitStateMark";
import { listenKeys } from "@/hooks/use-global-shortcuts";
import { useMediaQuery } from "@/hooks/use-media-query";
import { orpc } from "@/lib/api/orpc-client";
import { askSubject, whyAsked } from "@/lib/ask-lines";
import { formatDateTimeUtc } from "@/lib/format-time";
import { plainExcerpt } from "@/lib/inbound-rows";
import { lazyPart, useAfterFirstContent } from "@/lib/lazy";
import { settleEndsLine } from "@/lib/settle-holds";
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
	statusReason,
} from "@/lib/thread-status";
import { readableTitle } from "@/lib/title";
import { toolTitle } from "@/lib/tool-title";
import { cn } from "@/lib/utils";

// A row's peek and ask card load when one opens (#1101 category 12).
const RowCard = lazyPart(
	() => import("./RowCard").then((m) => m.RowCard),
	null,
	{
		now: true,
	},
);

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
	onMoreActive?: () => void;
	/** Every row open and the settled group shown: the design gallery's frames. */
	expandAll?: boolean;
	/** Rows not matching a filter are left out. */
	filter?: (n: ListNode) => boolean;
	/** A control on the Threads heading: the sidebar's started-by toggle. */
	threadsAction?: ReactNode;
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
	onMoreActive,
	expandAll = false,
	filter,
	threadsAction,
	children,
}: TreeProps) {
	const [settledOpen, setSettledOpen] = useState(expandAll);
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
	const rows = (n: ListNode, inNeeds = false): ReactNode[] =>
		keep(n) && budget-- > 0
			? [
					<ListRow
						key={n.id}
						node={n}
						now={now}
						on={currentId === n.id}
						asks={asks.get(n.id) ?? NO_ASKS}
						onSettle={onSettle ? settle : undefined}
						inNeeds={inNeeds}
					/>,
				]
			: [];
	const needs = model.needs.filter(keep);
	const active = model.active.filter(keep);
	const settledRows = model.settled.filter(keep);
	// Rows past the loaded pages count too, so "Show N more" stays until the last (#1101 cat 1.5).
	const activeLeft =
		Math.max(active.length, filter ? 0 : (activeTotal ?? 0)) - rowsShown;
	// Settled rows sit on the feed's later pages: an open group loads until it can show its count (#1101 cat 1.5).
	const settledWanted = Math.min(settledShown, model.settledCount);
	const settledShort = settledOpen && model.settled.length < settledWanted;
	useEffect(() => {
		if (settledShort) onMoreSettled?.();
	});
	// Rows a page or a Show more adds mount from a deferred pass React builds in slices, never
	// inside the task that brought the data (#1101 cat 1.8: no task over 100 ms while scrolling).
	const activeDrawn = useDeferredValue(Math.min(rowsShown, active.length));
	const settledDrawn = useDeferredValue(
		settledOpen ? Math.min(settledShown, settledRows.length) : 0,
	);
	return (
		<div className="flex flex-col gap-3" data-testid="thread-tree">
			{children}
			{needs.length > 0 && (
				<Section
					label="Needs you"
					count={filter ? needs.length : model.needsCount}
					tone="font-medium text-text-1"
					testId="thread-section-needs"
				>
					{needs.flatMap((n) => rows(n, true))}
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
				{!expandAll && activeLeft > 0 && (
					<MoreButton
						n={activeLeft}
						onClick={() => {
							setRowsShown((v) => v + 25);
							if (active.length < rowsShown + 25) onMoreActive?.();
						}}
						testId="threads-show-more"
					/>
				)}
			</Section>
			{model.settledCount > 0 && (
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
	tone,
	testId,
	action,
	children,
}: {
	label: string;
	count?: number;
	tone?: string;
	testId: string;
	/** One control at the heading's end, such as the started-by toggle. */
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={label}
			className="flex flex-col gap-px"
			data-testid={testId}
		>
			<h2 className="flex h-7 items-center px-2.5 text-meta text-text-3">
				{label}
				{count !== undefined && (
					<span
						className={cn("ml-auto tabular-nums", tone)}
						data-testid={`${testId}-count`}
					>
						{count}
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
	n: number;
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
			Show {n} more
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
		// A thread settled before newer activity is back in Threads and settles again (#1101 cat 2.2).
		node.unit.section !== "settled" &&
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
		} else if (e.key === "Escape" && moreShown) {
			e.preventDefault();
			setMoreHidden(true);
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
	const cardOpen = asking ? askOpen : peek;
	// Details on demand in the row's reserved gap: hover, focus or a tap shows them, Escape hides (#1101 cat 8.2).
	// Its text is drawn only while shown, so nothing else changes; screen readers get it always.
	const [moreAt, setMoreAt] = useState({ hover: false, focus: false });
	const [moreHidden, setMoreHidden] = useState(false);
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
	const moreShown = !!more && (moreAt.hover || moreAt.focus) && !moreHidden;
	// Escape closes a reveal the pointer opened, wherever focus is.
	useEffect(() => {
		if (!moreShown) return;
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") setMoreHidden(true);
		};
		return listenKeys(onKey);
	}, [moreShown]);
	const rowBox = useRef<HTMLDivElement>(null);
	if (renaming)
		return (
			<RenameField id={t.id} title={title} onDone={() => setRenaming(false)} />
		);
	// One status slot (sheet §1): the word while it says something, then its one time;
	// an idle row someone has read shows only its age. Actions take it on hover and focus.
	const running = mark === "working";
	const since = running && t.startedAt ? Date.parse(t.startedAt) : Number.NaN;
	const slotTime =
		running && !Number.isNaN(since) && now
			? elapsedWord(now - since)
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
	// Every row carries its word beside its shape, Needs you too (#1101 cat 1 item 4, cat 2 item 1).
	const word = statusShort(mark);
	const showWord = !!word;
	const agentLabel = t.harness ? agentName(t.harness) : null;
	const right = (
		<span
			className={cn(
				// Keyboard focus, not a click, swaps the slot for actions: a clicked row keeps its word.
				"flex shrink-0 items-center justify-end gap-1.5 text-meta tabular-nums group-hover/row:invisible group-has-[:focus-visible]/row:invisible group-has-[[data-row-actions]:focus-within]/row:invisible group-has-[[data-row-actions]_[data-state=open]]/row:invisible",
			)}
			data-testid="row-slot"
		>
			{t.harness && agentLabel && (
				<AgentBadge
					agent={t.harness}
					label={agentLabel}
					model={t.model}
					inRow
				/>
			)}
			{showWord && (
				<span
					className={cn(
						"max-sm:sr-only",
						running ? "text-accent" : wordTone(mark),
					)}
					data-testid="row-status"
					{...fact("status")}
				>
					{word}
				</span>
			)}
			<time
				dateTime={slotAt ? new Date(slotAt).toISOString() : undefined}
				className={running ? "text-accent" : "text-text-3"}
				data-testid="row-age"
				{...fact("activity")}
			>
				{slotTime}
			</time>
		</span>
	);
	// The second line only when it says something: where it stands, a starter, a PR or a branch (#1101 density).
	const cause = inNeeds && detail;
	// The second line shows only when it says something; a lone ↳ rides the title line (#1101).
	const said = !!(detail || t.pr || t.git || t.branch);
	const metaLine = said && (
		<span
			className="flex min-w-0 items-center gap-1.5 pl-5"
			data-testid="row-meta"
		>
			{/* A click on the mark opens the starter; the row's link opens the row (#1101 cat 10). */}
			{by && (
				<span className="flex w-3.5 shrink-0" data-starter={by.id}>
					<StartedByMark by={by} />
				</span>
			)}
			{/* A row that needs you says why on its second line (#1101 cat 1). */}
			{cause ? (
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					{t.git && <GitStateMark git={t.git} />}
					<span
						className="min-w-0 flex-1 truncate text-meta text-text-3"
						data-testid="row-cause"
						{...fact("cause")}
					>
						{detail}
					</span>
				</span>
			) : (
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					{t.pr && (
						<PrMark number={t.pr.number} tone={t.pr.tone} count={t.pr.count} />
					)}
					{t.git && <GitStateMark git={t.git} />}
					{/* The git state names the branch in its hint; the row keeps room for its word. */}
					{t.branch && !t.git && <BranchMark branch={t.branch} />}
					{/* Every row says where it stands on its second line, not only rows that need you (#1101 cat 1). */}
					{detail && (
						<span
							className="min-w-0 flex-1 truncate text-meta text-text-3"
							data-testid="row-detail"
						>
							{detail}
						</span>
					)}
				</span>
			)}
		</span>
	);
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
				onKeyDown={onKey}
				// The card's code loads as the row is reached, so Space opens it at once (#1101 cat 1).
				onPointerEnter={() => void RowCard.preload(true)}
				onFocus={() => void RowCard.preload(true)}
				onPointerOver={() =>
					!moreAt.hover && setMoreAt((m) => ({ ...m, hover: true }))
				}
				onPointerLeave={() => {
					setMoreHidden(false);
					setMoreAt((m) => ({ ...m, hover: false }));
				}}
				onFocusCapture={(e) =>
					more &&
					(e.target as HTMLElement).matches?.(":focus-visible") &&
					setMoreAt((m) => ({ ...m, focus: true }))
				}
				onBlur={() => {
					setMoreHidden(false);
					setMoreAt((m) => ({ ...m, focus: false }));
				}}
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
							"flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-control py-1.5 pr-2 pl-2.5 text-text-2 max-sm:min-h-11 transition-colors duration-(--dur-instant) hover:bg-surface-2 focus-visible:bg-surface-3",
							on && "bg-surface-3 hover:bg-surface-3",
						)}
						data-testid="thread-row"
						data-id={t.id}
						data-state={mark}
						data-started-by={by?.via}
						data-quiet={quiet || undefined}
					>
						<span className="flex min-w-0 items-center gap-1.5">
							<Hint label={statusWord(mark)}>
								<span
									role="img"
									aria-label={statusWord(mark)}
									className="flex shrink-0"
									{...fact("status")}
								>
									<StatusMark status={mark} />
								</span>
							</Hint>
							<Hint
								// An open peek or ask card says it all; the hint would sit over it.
								when={!cardOpen}
								label={by ? `${title} · ${startedByLabel(by)}` : title}
								meta={
									[detail, slotAt ? formatDateTimeUtc(slotAt) : null]
										.filter(Boolean)
										.join(" · ") || undefined
								}
								side="right"
							>
								<span
									dir="auto"
									className={cn(
										"min-w-0 flex-1 truncate text-body",
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
							</Hint>
							{by && !said && (
								<span className="flex w-3.5 shrink-0" data-starter={by.id}>
									<StartedByMark by={by} />
								</span>
							)}
							{right}
						</span>
						{metaLine}
					</Link>
				</div>
				{more && (
					<p
						aria-hidden
						className="-mt-1 h-4 truncate pr-2 pl-[30px] text-meta text-text-3"
						data-testid="row-ask-more"
						data-open={moreShown || undefined}
					>
						{moreShown ? more : null}
					</p>
				)}
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
							<Peek node={node} now={now} title={title} />
						)}
					</RowCard>
				)}
				<div
					className={cn(
						"absolute top-1 right-1 hidden items-center group-hover/row:flex group-has-[:focus-visible]/row:flex focus-within:flex has-[[data-state=open]]:flex",
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

/** Space, or Answer on an ask row: the last agent sentence and what holds the thread. */
function Peek({
	node,
	now,
	title,
}: {
	node: ListNode;
	now: number;
	title: string;
}) {
	const t = node.thread;
	const reason = statusReason(t, node.info, now);
	return (
		<div className="flex flex-col gap-1.5 text-body">
			<p className="truncate font-medium text-text-1">{title}</p>
			<p className="flex items-center gap-1.5 text-meta">
				<StatusMark status={node.info.status} />
				<span className={cn("font-medium", wordTone(node.info.status))}>
					{statusWord(node.info.status)}
				</span>
			</p>
			{reason && <p className="line-clamp-2 text-meta text-text-3">{reason}</p>}
			{t.startedBy && (
				<p className="flex items-center gap-1.5 text-meta text-text-2">
					<StartedByMark by={t.startedBy} />
					<span className="min-w-0 truncate">
						{startedByLabel(t.startedBy)}
					</span>
				</p>
			)}
			<p
				dir="auto"
				className="line-clamp-4 text-meta text-text-2"
				data-testid="peek-latest"
			>
				{lastPlainLine(t.latestText) ?? "No reply yet"}
			</p>
			{t.pr && (
				<p className="text-meta text-text-2">
					PR #{t.pr.number} {t.pr.tone}
				</p>
			)}
		</div>
	);
}

/** The row's one-click Settle; its hint previews what Settle ends, read on first hover (#1101 cat 2). */
function RowSettle({ id, onSettle }: { id: string; onSettle: () => void }) {
	const [asked, setAsked] = useState(false);
	const preview = useQuery({
		...orpc.threads.settlePreview.queryOptions({ input: { id } }),
		enabled: asked,
		staleTime: 30_000,
	});
	const ask = () => setAsked(true);
	return (
		<Hint
			label="Settle"
			{...(preview.data ? { meta: settleEndsLine(preview.data) } : {})}
		>
			<button
				type="button"
				aria-label="Settle"
				onClick={onSettle}
				onPointerEnter={ask}
				onFocus={ask}
				className="flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="thread-settle"
			>
				<Check className="size-3.5" aria-hidden />
			</button>
		</Hint>
	);
}
