// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	isWorkflowLive,
	type ThreadRow,
	type ThreadStatus,
	type ThreadStatusInfo,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { Popover as P } from "radix-ui";
import {
	createContext,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useRef,
	useState,
} from "react";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
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
import { askSubject, waitedFor } from "@/lib/ask-lines";
import {
	type ListNode,
	recedes,
	type ThreadListModel,
} from "@/lib/thread-list";
import {
	rowLine,
	severityColor,
	severityWord,
	threadLink,
} from "@/lib/thread-rows";
import {
	ageWord,
	infoReason,
	needsYouNow,
	STATUS_LOUD,
	STATUS_SHAPE,
	STATUS_TONE,
	STATUS_WORD,
	statusReason,
	TONE_TEXT,
} from "@/lib/thread-status";
import { readableTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

/**
 * Whether a row reads as unread (bold title). The list's default is the feed's
 * `unseen`; the read-state lane feeds its server-synced answer through this seam.
 */
export const RowUnread = createContext<(t: ThreadRow) => boolean>(
	(t) => t.unseen,
);

/** The deepest indent a child gets; deeper ones sit at it. */
const INDENT_MAX = 3;
/** Roots and settled rows shown before "Show N more". */
const ROOTS_SHOWN = 15;
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
			<span
				className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
				data-testid="status-label"
				data-state={info.status}
			>
				<StatusMark status={info.status} />
				<span className={cn("shrink-0 font-medium", wordTone(info.status))}>
					{STATUS_WORD[info.status]}
				</span>
				{reason && <span className="sr-only">, {reason}</span>}
			</span>
		</Hint>
	);
}

/** Only the icon carries colour (sheet §9.1); a word that needs you reads at full strength. */
export const wordTone = (s: ThreadStatus) =>
	STATUS_LOUD.has(s) ? "text-text-1" : "text-text-2";

/** The title and link a node opens: an incident's block opens its incident. */
function rowMeta(n: ListNode) {
	const chip = n.unit.incident;
	if (chip && n.parentTitle === null && n.unit.threads.length > 0)
		return {
			title:
				n.thread.triggerType && n.thread.triggerType !== "manual"
					? readableTitle(chip.title)
					: chip.title,
			link: threadLink(n.thread),
			chip,
		};
	return {
		title:
			n.thread.title?.trim() || (n.thread.kind === "chat" ? "Thread" : "Run"),
		link: threadLink(n.thread),
		chip: null,
	};
}

/** The detail line: the status reason, else the live step, the answer or the cause. */
export function detailLine(
	n: ListNode,
	now: number,
	ask?: RowAskEntry,
	own = false,
): string | null {
	if (n.rolled && !own) return n.rolled.line;
	// An ask row says what is asked and how long ago (#1101 category 8 item 1).
	if (ask)
		return `${askSubject(ask.ask) ?? ask.ask.title}, ${waitedFor(ask.ask.openedAt, now)}`;
	return statusReason(n.thread, n.info, now) ?? rowLine(n.thread);
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
	/** Rows not matching a typed filter are left out; roots stay while a child matches. */
	filter?: (n: ListNode) => boolean;
	children?: ReactNode;
}

/**
 * The thread list (#1101 category 1): Needs you on top with its full count, pinned
 * threads, roots that roll their children into one mark and expand in place, and
 * Settled folded at the foot. Visual order is DOM order, so j/k and Tab follow it.
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
	const [open, setOpen] = useState<Set<string>>(new Set());
	const [settledOpen, setSettledOpen] = useState(expandAll);
	const [rootsShown, setRootsShown] = useState(ROOTS_SHOWN);
	const [settledShown, setSettledShown] = useState(SETTLED_SHOWN);
	const keep = (n: ListNode): boolean =>
		!filter || filter(n) || n.children.some(keep);
	const toggle = (id: string) =>
		setOpen((s) => {
			const next = new Set(s);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const rows = (
		n: ListNode,
		depth: number,
		opts: { parent?: boolean; single?: boolean } = {},
	): ReactNode[] => {
		if (!keep(n)) return [];
		const flat = opts.parent || opts.single;
		const expanded =
			expandAll || open.has(n.id) || (!!filter && n.children.some(keep));
		return [
			<TreeRow
				key={`${n.id}-${depth}-${opts.parent ? "n" : "t"}`}
				node={n}
				depth={depth}
				now={now}
				on={currentId === n.id}
				asks={asks.get(n.id) ?? []}
				expanded={expanded}
				onToggle={n.children.length && !flat ? () => toggle(n.id) : undefined}
				onSettle={onSettle}
				showParent={!!opts.parent}
				askOpenAtStart={expandAll}
			/>,
			...(expanded && !flat
				? n.children.flatMap((c) => rows(c, depth + 1))
				: []),
		];
	};
	const needs = model.needs.filter((n) => !filter || filter(n));
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
					{needs.flatMap((root) => [
						...rows(root, 0, { single: true }),
						// The threads in the tree that wait on you, under their root.
						...descendantsOf(root)
							.filter((d) => needsYouNow(d.thread, d.info))
							.flatMap((d) => rows(d, 1, { single: true })),
					])}
				</Section>
			)}
			{model.pinned.filter(keep).length > 0 && (
				<Section label="Pinned" testId="thread-section-pinned">
					{model.pinned.filter(keep).flatMap((n) => rows(n, 0))}
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
						.slice(0, expandAll ? undefined : rootsShown)
						.flatMap((n) => rows(n, 0))
				)}
				{!expandAll && active.length > rootsShown && (
					<MoreButton
						n={active.length - rootsShown}
						onClick={() => setRootsShown((v) => v + 25)}
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
							{settledRows.slice(0, settledShown).flatMap((n) => rows(n, 0))}
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

function descendantsOf(n: ListNode): ListNode[] {
	return n.children.flatMap((c) => [c, ...descendantsOf(c)]);
}

/** Left and right arrows fold and open a root; 0 for any other key. */
const arrow = (key: string): -1 | 0 | 1 =>
	key === "ArrowLeft"
		? -1
		: key.startsWith("Arrow") && key.endsWith("Right")
			? 1
			: 0;

/** Hover opens the peek after this long, so a pass of the pointer never flashes it. */
const PEEK_DELAY_MS = 450;

function TreeRow({
	node,
	depth,
	now,
	on,
	asks,
	expanded,
	onToggle,
	onSettle,
	showParent,
	askOpenAtStart = false,
}: {
	askOpenAtStart?: boolean;
	node: ListNode;
	depth: number;
	now: number;
	on: boolean;
	asks: RowAskEntry[];
	expanded: boolean;
	onToggle?: () => void;
	onSettle?: (t: ThreadRow) => void;
	/** A Needs-you row names the tree it sits in. */
	showParent: boolean;
}) {
	const unread = useContext(RowUnread)(node.thread);
	const navigate = useNavigate();
	// One card beside the row (sheet §1): the ask when it waits, else the peek.
	const [peek, setPeek] = useState(false);
	const [askOpen, setAskOpen] = useState(askOpenAtStart);
	const roomy = useMediaQuery("(min-width: 640px)");
	const [renaming, setRenaming] = useState(false);
	const timer = useRef<number | null>(null);
	const entry = asks[0];
	const ask = useRowAsk(entry);
	const gone = useGone(entry?.ask.askId ?? null, ask.mine);
	const meta = rowMeta(node);
	// A Needs-you row shows its own status; a root in the tree shows its roll-up.
	const rolled = showParent ? null : node.rolled;
	const mark = rolled?.top ?? node.info.status;
	const detail = detailLine(node, now, entry, showParent);
	const t = node.thread;
	const quiet = recedes(node) && !on;
	const indent = Math.min(depth, INDENT_MAX);
	const settleable =
		!isWorkflowLive(t.status) &&
		!t.settledAt &&
		node.info.status !== "approval" &&
		node.info.status !== "question";
	const open = () => void navigate(meta.link);
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
		} else if (arrow(e.key) === 1 && onToggle && !expanded) {
			e.preventDefault();
			onToggle();
		} else if (arrow(e.key) === -1 && onToggle && expanded) {
			e.preventDefault();
			onToggle();
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
	const hoverIn = () => {
		if (timer.current) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(
			() => (entry ? setAskOpen(true) : setPeek(true)),
			PEEK_DELAY_MS,
		);
	};
	// Leaving the row for its card keeps the card: the pointer crosses a small gap.
	const hoverOut = () => {
		if (timer.current) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			setPeek(false);
			if (!askOpenAtStart) setAskOpen(false);
		}, 200);
	};
	const cardOpen = entry ? askOpen : peek;
	if (renaming)
		return (
			<RenameField
				id={t.id}
				title={meta.title}
				onDone={() => setRenaming(false)}
			/>
		);
	const right = (
		<span className="flex shrink-0 items-center gap-1.5 text-meta text-text-3 tabular-nums group-focus-within/row:invisible group-hover/row:invisible">
			{meta.chip && (
				<Hint
					label={`${severityWord(meta.chip.severity)} severity`}
					side="right"
				>
					<span
						className="block size-1.5 rounded-full"
						style={{ background: severityColor(meta.chip.severity) }}
						data-testid="row-severity"
					>
						<span className="sr-only">{severityWord(meta.chip.severity)}</span>
					</span>
				</Hint>
			)}
			{t.pr && (
				<span className="font-mono" data-testid="row-pr">
					#{t.pr.number}
				</span>
			)}
			{rolled && <span data-testid="row-children">{rolled.count}</span>}
			<span data-testid="row-age">{now ? ageWord(node.at, now) : null}</span>
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
						<div
							className="flex items-stretch"
							style={{ paddingLeft: indent * 12 }}
							onMouseEnter={hoverIn}
							onMouseLeave={hoverOut}
						>
							{onToggle ? (
								<button
									type="button"
									aria-label={
										expanded
											? "Collapse"
											: `Expand ${node.children.length} threads`
									}
									aria-expanded={expanded}
									onClick={onToggle}
									className="flex w-5 shrink-0 items-center justify-center rounded-control text-text-3 hover:bg-surface-3 hover:text-text-1"
									data-testid="row-expand"
								>
									<ChevronRight
										aria-hidden
										className={cn(
											"size-3 transition-transform",
											expanded && "rotate-90",
										)}
									/>
								</button>
							) : (
								<span className="w-5 shrink-0" />
							)}
							<Link
								{...meta.link}
								aria-current={on ? "page" : undefined}
								aria-keyshortcuts={entry ? "Y N Space" : "Space"}
								className={cn(
									"flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-control py-1.5 pr-2 pl-1 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 focus-visible:bg-surface-3",
									on && "bg-surface-3 hover:bg-surface-3",
								)}
								data-testid="thread-row"
								data-id={t.id}
								data-state={mark}
								data-quiet={quiet || undefined}
							>
								<span className="flex min-w-0 items-center gap-1.5">
									<StatusMark status={mark} />
									<span
										dir="auto"
										className={cn(
											"min-w-0 flex-1 truncate text-body",
											unread || on
												? "font-medium text-text-1"
												: quiet
													? "text-text-3"
													: "text-text-1",
										)}
										data-testid="row-title"
									>
										{meta.title}
										{showParent && node.parentTitle && (
											<span className="font-normal text-text-3">
												{" "}
												in {node.parentTitle}
											</span>
										)}
									</span>
									{right}
								</span>
								<span className="flex min-w-0 items-center gap-1 pl-5 text-meta">
									<span
										className={cn(
											"shrink-0",
											quiet ? "text-text-3" : wordTone(mark),
										)}
										data-testid="row-status"
									>
										{STATUS_WORD[mark]}
									</span>
									{detail && (
										<>
											<span aria-hidden className="text-text-3">
												·
											</span>
											<span
												dir="auto"
												className="min-w-0 truncate text-text-3"
												data-testid="row-detail"
											>
												{detail}
											</span>
										</>
									)}
								</span>
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
							onMouseEnter={() => {
								if (timer.current) window.clearTimeout(timer.current);
							}}
							onMouseLeave={hoverOut}
							aria-label={entry ? "Waiting ask" : meta.title}
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
								<Peek node={node} now={now} title={meta.title} />
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
						style={{ paddingLeft: indent * 12 + 30 }}
						data-testid="row-ask-elsewhere"
					>
						Answered on another device
					</p>
				)}
			</div>
		</ThreadContextMenu>
	);
}

/** Space or a resting pointer: the last agent sentence and what holds the thread. */
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
			{node.rolled && (
				<p className="text-meta text-text-2">{node.rolled.line}</p>
			)}
			<p
				dir="auto"
				className="line-clamp-4 text-meta text-text-2"
				data-testid="peek-latest"
			>
				{t.latestText ?? "No reply yet"}
			</p>
			{t.pr && (
				<p className="text-meta text-text-2">
					PR #{t.pr.number} {t.pr.tone}
				</p>
			)}
		</div>
	);
}
