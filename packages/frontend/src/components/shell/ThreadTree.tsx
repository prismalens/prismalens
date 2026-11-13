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
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight, MessageSquareReply } from "lucide-react";
import { Popover as P } from "radix-ui";
import {
	createContext,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useState,
} from "react";
import { Status } from "@/components/kit";
import {
	AgentBadge,
	BranchMark,
	PrMark,
	StartedByMark,
	startedByLabel,
} from "@/components/kit/MarkBadges";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import { relTime } from "@/components/kit/rel-time";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { RenameField } from "@/components/shell/RenameField";
import {
	RowAsk,
	type RowAskEntry,
	useGone,
	useRowAsk,
} from "@/components/shell/RowAsk";
import { ThreadContextMenu, ThreadMenu } from "@/components/shell/ThreadMenu";
import { useMediaQuery } from "@/hooks/use-media-query";
import { askSubject } from "@/lib/ask-lines";
import { formatDateTime } from "@/lib/format-time";
import { plainExcerpt } from "@/lib/inbound-rows";
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
	STATUS_LOUD,
	STATUS_SHAPE,
	STATUS_SHORT,
	STATUS_TONE,
	STATUS_WORD,
	statusReason,
	TONE_TEXT,
} from "@/lib/thread-status";
import { readableTitle } from "@/lib/title";
import { toolTitle } from "@/lib/tool-title";
import { cn } from "@/lib/utils";

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

/** One status as a shape in its colour, the word for screen readers (#1101 category 2 item 1). */
export function StatusMark({
	status,
	className,
}: {
	status: ThreadStatus;
	className?: string;
}) {
	if (status === "working")
		return (
			<span
				className={cn("flex size-4 items-center justify-center", className)}
			>
				<Ring className="text-accent" />
			</span>
		);
	const Icon = STATUS_SHAPE[status];
	return (
		<Icon
			aria-hidden
			className={cn(
				"size-3.5 shrink-0 stroke-[1.75]",
				TONE_TEXT[STATUS_TONE[status]],
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
}: {
	info: ThreadStatusInfo;
	now: number;
	className?: string;
}) {
	const reason = infoReason(info, now);
	return (
		<Hint label={reason ?? STATUS_WORD[info.status]} when={!!reason}>
			{/* The kit's Status: one icon, colour and word for a state everywhere (sheet §0.6). */}
			<span
				className={cn("inline-flex min-w-0 items-center", className)}
				data-testid="status-label"
				data-state={info.status}
			>
				<Status kind={info.status} word={STATUS_WORD[info.status]} />
				{reason && <span className="sr-only">, {reason}</span>}
			</span>
		</Hint>
	);
}

/** Only the icon carries colour (sheet §9.1); a word that needs you reads at full strength. */
export const wordTone = (s: ThreadStatus) =>
	STATUS_LOUD.has(s) ? "text-text-1" : "text-text-2";

/** The title a row shows: an alert's run reads as its incident; any other thread by its own title. */
function rowTitle(n: ListNode): string {
	const chip = n.unit.incident;
	if (chip && n.thread.triggerType && n.thread.triggerType !== "manual")
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
	/** Every row open and the settled group shown: the design gallery's frames. */
	expandAll?: boolean;
	/** Rows not matching a filter are left out. */
	filter?: (n: ListNode) => boolean;
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
	expandAll = false,
	filter,
	children,
}: TreeProps) {
	const [settledOpen, setSettledOpen] = useState(expandAll);
	const [rowsShown, setRowsShown] = useState(ROWS_SHOWN);
	const [settledShown, setSettledShown] = useState(SETTLED_SHOWN);
	const keep = (n: ListNode): boolean => !filter || filter(n);
	const rows = (n: ListNode, inNeeds = false): ReactNode[] =>
		keep(n)
			? [
					<ListRow
						key={n.id}
						node={n}
						now={now}
						on={currentId === n.id}
						asks={asks.get(n.id) ?? []}
						onSettle={onSettle}
						inNeeds={inNeeds}
					/>,
				]
			: [];
	const needs = model.needs.filter(keep);
	const active = model.active.filter(keep);
	const settledRows = model.settled.filter(keep);
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
			<Section label="Threads" testId="thread-section-threads">
				{active.length === 0 ? (
					<p
						className="px-2.5 py-1 text-body text-text-3"
						data-testid="threads-empty"
					>
						{filter ? "No threads match" : "Nothing running"}
					</p>
				) : (
					active
						.slice(0, expandAll ? undefined : rowsShown)
						.flatMap((n) => rows(n))
				)}
				{!expandAll && active.length > rowsShown && (
					<MoreButton
						n={active.length - rowsShown}
						onClick={() => setRowsShown((v) => v + 25)}
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
							{settledRows.slice(0, settledShown).flatMap((n) => rows(n))}
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
	children,
}: {
	label: string;
	count?: number;
	tone?: string;
	testId: string;
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

function ListRow({
	node,
	now,
	on,
	asks,
	onSettle,
	inNeeds = false,
	askOpenAtStart = false,
}: {
	askOpenAtStart?: boolean;
	node: ListNode;
	now: number;
	on: boolean;
	asks: RowAskEntry[];
	onSettle?: (t: ThreadRow) => void;
	/** In the Needs you group, which already says why: the icon is enough. */
	inNeeds?: boolean;
}) {
	const unread = useContext(RowUnread)(node.thread);
	const navigate = useNavigate();
	// One card beside the row (sheet §1): the ask when it waits, else the peek.
	const [peek, setPeek] = useState(false);
	const [askOpen, setAskOpen] = useState(askOpenAtStart);
	const roomy = useMediaQuery("(min-width: 640px)");
	const [renaming, setRenaming] = useState(false);
	const entry = asks[0];
	const ask = useRowAsk(entry);
	const gone = useGone(entry?.ask.askId ?? null, ask.mine);
	const title = rowTitle(node);
	const link = threadLink(node.thread);
	const mark = node.info.status;
	const detail = detailLine(node, now, entry);
	const t = node.thread;
	const by = t.startedBy ?? null;
	const quiet = recedes(node) && !on;
	const settleable =
		!isWorkflowLive(t.status) &&
		!t.settledAt &&
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
			if (entry) setAskOpen((o) => !o);
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
	const cardOpen = entry ? askOpen : peek;
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
	// Inside Needs you the group says why, so the icon is enough; elsewhere the shortest word.
	const word = inNeeds ? null : STATUS_SHORT[mark];
	const showWord = !!word && !quiet;
	const right = (
		<span
			className={cn(
				"flex shrink-0 items-center justify-end gap-1.5 text-meta tabular-nums group-focus-within/row:invisible group-hover/row:invisible",
				on && "invisible",
			)}
			data-testid="row-slot"
		>
			{showWord && (
				<span
					className={cn(
						"max-sm:sr-only",
						running ? "text-accent" : wordTone(mark),
					)}
					data-testid="row-status"
				>
					{word}
				</span>
			)}
			<time
				dateTime={slotAt ? new Date(slotAt).toISOString() : undefined}
				className={running ? "text-accent" : "text-text-3"}
				data-testid="row-age"
			>
				{slotTime}
			</time>
		</span>
	);
	const agent = t.harness ? agentName(t.harness) : null;
	// Every row has the same two lines, its marks in fixed columns, so heights never jump (#1101).
	const metaLine = (
		<span
			className="flex min-w-0 items-center gap-1.5 pl-5"
			data-testid="row-meta"
		>
			<span className="flex w-3.5 shrink-0">
				{t.harness && agent && (
					<AgentBadge agent={t.harness} label={agent} model={t.model} />
				)}
			</span>
			{/* A click on the mark opens the starter; the row's link opens the row (#1101 cat 10). */}
			<span className="flex w-3.5 shrink-0" data-starter={by?.id}>
				{by && <StartedByMark by={by} />}
			</span>
			<span className="flex min-w-11 shrink-0">
				{t.pr && (
					<PrMark number={t.pr.number} tone={t.pr.tone} count={t.pr.count} />
				)}
			</span>
			<span className="flex min-w-0 flex-1">
				{t.branch && <BranchMark branch={t.branch} />}
			</span>
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
			>
				<P.Root
					open={cardOpen}
					onOpenChange={(o) => {
						if (!o) {
							setPeek(false);
							setAskOpen(false);
						}
					}}
				>
					<P.Anchor asChild>
						<div className="flex items-stretch">
							<Link
								{...link}
								onClick={(e) => {
									if (!by) return;
									const el = e.target as Element;
									if (!el.closest?.("[data-starter]")) return;
									e.preventDefault();
									void navigate({ to: "/threads/$id", params: { id: by.id } });
								}}
								aria-current={on ? "page" : undefined}
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
									<Hint label={STATUS_WORD[mark]}>
										<span
											role="img"
											aria-label={STATUS_WORD[mark]}
											className="flex shrink-0"
										>
											<StatusMark status={mark} />
										</span>
									</Hint>
									<Hint
										label={by ? `${title} · ${startedByLabel(by)}` : title}
										meta={
											[detail, slotAt ? formatDateTime(slotAt) : null]
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
										>
											{title}
										</span>
									</Hint>
									{right}
								</span>
								{metaLine}
							</Link>
						</div>
					</P.Anchor>
					<P.Portal>
						<P.Content
							side={roomy ? "right" : "bottom"}
							align="start"
							sideOffset={6}
							collisionPadding={8}
							onOpenAutoFocus={(e) => e.preventDefault()}
							onCloseAutoFocus={(e) => e.preventDefault()}
							aria-label={entry ? "Waiting ask" : title}
							data-float="pop"
							className={cn(SURFACE, FAMILY_CLASS.card, "p-2.5")}
							data-testid={entry ? "row-ask-card" : "row-peek"}
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
							) : (
								<Peek node={node} now={now} title={title} />
							)}
						</P.Content>
					</P.Portal>
				</P.Root>
				<div
					className={cn(
						"absolute top-1 right-1 hidden items-center group-focus-within/row:flex group-hover/row:flex",
						on && "flex",
					)}
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
						<Hint label="Settle">
							<button
								type="button"
								aria-label="Settle"
								onClick={() => onSettle(t)}
								className="flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
								data-testid="thread-settle"
							>
								<Check className="size-3.5" aria-hidden />
							</button>
						</Hint>
					)}
					<ThreadMenu
						thread={t}
						where="row"
						onRename={() => setRenaming(true)}
						{...(onSettle ? { onSettle: () => onSettle(t) } : {})}
					/>
				</div>
				{!entry && gone && (
					<p
						className="pb-1.5 text-meta text-text-2"
						style={{ paddingLeft: 30 }}
						data-testid="row-ask-elsewhere"
					>
						Answered on another device
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
					{STATUS_WORD[node.info.status]}
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
