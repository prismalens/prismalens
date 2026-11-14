// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ThreadRow as FeedRow,
	type IncidentWithRelations,
	isAlertFiring,
	isWorkflowLive,
	type ThreadUnit,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
	Bell,
	CalendarClock,
	Check,
	Clock3,
	Pencil,
	Square,
	User,
	Webhook,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { runElapsed } from "@/components/incidents/run-facts";
import { StartedByMark } from "@/components/kit/MarkBadges";
import { relTime } from "@/components/kit/rel-time";
import { startedByUser } from "@/components/run/trigger-types";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { RenameField } from "@/components/shell/RenameField";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { useOpenSearch } from "@/components/shell/SearchHost";
import { ThreadTreeView } from "@/components/shell/ThreadTree";
import { gitWord } from "@/components/thread/git/git-state";
import { Input } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import { useRowKeys } from "@/hooks/use-row-keys";
import { useSettleUndo } from "@/hooks/use-settle-undo";
import { useCancelInvestigation } from "@/lib/api/hooks";
import { useAnsweredHere } from "@/lib/api/hooks/use-investigations-orpc";
import {
	type ThreadFeedInput,
	useRenameThread,
	useSettleThread,
	useThreadAsks,
	useThreadFeed,
} from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatElapsed } from "@/lib/format-time";
import { rowWhen } from "@/lib/thread-groups";
import {
	type ListNode,
	type ThreadListModel,
	threadList,
} from "@/lib/thread-list";
import {
	announcements,
	rowState,
	sectionsOf,
	type ThreadLink,
	threadLink,
} from "@/lib/thread-rows";
import { afterAnswers } from "@/lib/thread-status";
import { readableTitle } from "@/lib/title";
import {
	isPlainChat,
	TRIGGER_WORD,
	type TriggerKind,
	triggerOf,
} from "@/lib/trigger";
import { cn } from "@/lib/utils";

type State = "asks" | "failed" | "limited" | "working" | "ready" | "new" | null;

/** Surface F's row fields (#1024); read only when its contract has landed. */
interface LifecycleFields {
	paused?: boolean | { reason?: string | null } | null;
	limit?: { resetsAt?: string | null } | null;
}
const lifecycle = (t: FeedRow) => t as FeedRow & LifecycleFields;

/** A thread's automatic updates are paused; it waits for you like an ask. */
export const isPaused = (t: FeedRow) => !!lifecycle(t).paused;
const pausedReason = (t: FeedRow) => {
	const p = lifecycle(t).paused;
	return typeof p === "object" && p?.reason ? p.reason : null;
};
const isLimited = (t: FeedRow) => !!lifecycle(t).limit;

type RowLink =
	| ThreadLink
	| { to: "/incidents/$id"; params: { id: string } }
	| { to: "/incidents/$id/conversation"; params: { id: string } };

/** One row: a thread, or an incident's block of threads, the same shape either way. */
export interface ThreadRow {
	key: string;
	title: string;
	origin: TriggerKind;
	state: State;
	hint: string;
	/** The alert's own state, apart from the agent's: firing until it clears (#1020). */
	firing?: boolean;
	at: number;
	link: RowLink;
	/** The thread Rename, Stop and Settle act on; an incident's first covers its block. */
	thread: FeedRow;
	/** Settled by hand or by quiet days: off Recents, still on the Threads page. */
	settled: boolean;
	incidentId?: string;
	incidentClosed?: boolean;
	service?: string | null;
	/** The live run, for the working time. */
	live?: { status: string; startedAt: string | null; createdAt: string };
}

/** One mark per trigger kind; the row, the trigger card and Home share it. */
export const TRIGGER_ICON = {
	you: User,
	alert: Bell,
	webhook: Webhook,
	schedule: CalendarClock,
} as const;

const time = (at: string | null | undefined) => (at ? Date.parse(at) : 0);

/**
 * The one mark a unit shows (#1024): a waiting ask or paused updates, then a
 * failure, a usage limit, a run, a finding, news. A failing PR adds no mark.
 */
export function unitState(threads: FeedRow[]): State {
	const states = threads.map(rowState);
	if (states.includes("ask") || threads.some(isPaused)) return "asks";
	if (states.includes("failed")) return "failed";
	if (threads.some(isLimited)) return "limited";
	if (states.includes("live")) return "working";
	if (states.includes("new"))
		return threads.some((t) => t.rootCause?.trim()) ? "ready" : "new";
	return null;
}

/**
 * A feed unit as one row (#1020). `incident` is the open incident behind it,
 * when loaded: it tells an alert from a webhook and whether the alert still fires.
 */
export function unitRow(
	unit: ThreadUnit,
	incident?: IncidentWithRelations,
): ThreadRow {
	const first = unit.threads[0] as FeedRow;
	const live = unit.threads.find((t) => isWorkflowLive(t.status));
	const chip = unit.incident;
	const origin: TriggerKind = first.scheduleId
		? "schedule"
		: incident
			? triggerOf(incident).kind
			: chip && !startedByUser(first.triggerType)
				? "alert"
				: "you";
	const service = first.serviceName ?? first.projectName;
	const chat = !!incident && isPlainChat(incident);
	const title = chip
		? origin === "you"
			? chip.title
			: readableTitle(chip.title)
		: first.title?.trim() || (first.kind === "chat" ? "Thread" : "Run");
	return {
		key: chip ? `i-${chip.id}` : `t-${first.id}`,
		title,
		origin,
		state: unitState(unit.threads),
		hint: [
			first.hasDraft ? "Draft" : null,
			chip && !chat ? `INC-${chip.number}` : null,
			service,
			TRIGGER_WORD[origin],
			...unit.threads.flatMap(stateHint),
		]
			.filter(Boolean)
			.join(", "),
		at: Math.max(...unit.threads.map((t) => time(t.lastActivityAt))),
		firing:
			origin === "alert" &&
			!!incident &&
			incident.status !== "closed" &&
			(incident.alerts ?? []).some((a) => isAlertFiring(a.status)),
		link: chip
			? chat
				? { to: "/incidents/$id/conversation", params: { id: chip.id } }
				: { to: "/incidents/$id", params: { id: chip.id } }
			: threadLink(first),
		thread: first,
		settled: unit.section === "settled",
		incidentId: chip?.id,
		incidentClosed: chip?.status === "closed",
		service,
		...(live
			? {
					live: {
						status: live.status,
						startedAt: live.startedAt ?? null,
						createdAt: live.createdAt,
					},
				}
			: {}),
	};
}

/** What a thread's own state adds to the hint: paused updates, a limit's reset, a failing PR. */
export function stateHint(t: FeedRow): string[] {
	const out: string[] = [];
	if (isPaused(t)) {
		const why = pausedReason(t);
		out.push(
			why ? `Automatic updates paused: ${why}` : "Automatic updates paused",
		);
	}
	const limit = lifecycle(t).limit;
	if (limit)
		out.push(
			limit.resetsAt
				? `Limited · resumes ${relTime(limit.resetsAt, Date.now())}`
				: "Limited",
		);
	if (t.pr?.tone === "failing") out.push("PR failing");
	if (t.git) out.push(gitWord(t.git));
	return out;
}

/** What started a thread, in a word; a thread you started needs none (#1020). */
export const ORIGIN_WORD: Record<TriggerKind, string | null> = {
	you: null,
	alert: "Alert",
	webhook: "Webhook",
	schedule: "Scheduled",
};
/** What a thread's agent work is doing, in words, never a lone glyph (#1020). */
export const STATE_WORD: Record<NonNullable<State>, string> = {
	asks: "Approval needed",
	failed: "Failed",
	limited: "Limited",
	working: "Working",
	ready: "Likely cause",
	new: "New",
};
const STATE_TONE: Record<NonNullable<State>, string> = {
	asks: "text-warn",
	failed: "text-danger",
	limited: "text-warn",
	working: "text-text-2",
	ready: "text-accent",
	new: "text-accent",
};
/** Recents rows before View all. */
const RECENT = 12;
/** Waiting threads shown before View all. */
const WAITING = 3;

/** Every thread, whoever started it, as rows: the feed joined to open incidents. */
export function useThreadRows(input: ThreadFeedInput = {}, enabled = true) {
	const feed = useThreadFeed(input, enabled);
	const { incidents } = useActiveIncidents(enabled);
	const units = useMemo(
		() => feed.data?.pages.flatMap((p) => p.units) ?? [],
		[feed.data],
	);
	const rows = useMemo(() => {
		const byId = new Map(incidents.map((i) => [i.id, i]));
		return units.map((u) =>
			unitRow(u, u.incident ? byId.get(u.incident.id) : undefined),
		);
	}, [units, incidents]);
	return { rows, units, feed, isLoading: feed.isLoading };
}

/** How many threads need you: the rail's and the phone strip's count (#1101 category 8 item 1). */
export function useWaitingCount(enabled = true): number {
	return useThreadListModel({}, enabled).model.needsCount;
}

/** Open asks by thread, oldest first: the rows answer them in place (#1101 category 8). */
export function useAsksByThread(enabled = true): Map<string, RowAskEntry[]> {
	const { data } = useThreadAsks(enabled);
	return useMemo(() => {
		const map = new Map<string, RowAskEntry[]>();
		for (const a of data?.asks ?? []) {
			const list = map.get(a.ask.threadId) ?? [];
			list.push(a);
			map.set(a.ask.threadId, list);
		}
		return map;
	}, [data]);
}

/** The list's model from the feed: what the sidebar and the Threads page draw. */
export function useThreadListModel(
	input: ThreadFeedInput = {},
	enabled = true,
) {
	const { units, feed, isLoading } = useThreadRows(input, enabled);
	const counts = feed.data?.pages[0]?.counts;
	const answered = useAnsweredHere();
	const asks = useAsksByThread(enabled);
	const model = useMemo(
		() =>
			threadList(units, counts?.needsThreads, counts?.settled, (t, info) =>
				afterAnswers(
					t.id,
					info,
					answered,
					(asks.get(t.id) ?? []).map((e) => e.ask.askId),
				),
			),
		[units, counts?.needsThreads, counts?.settled, answered, asks],
	);
	return { model, units, feed, isLoading };
}

/**
 * The sidebar's list (#1101 category 1): Needs you with its full count, pinned,
 * every thread flat, and Settled folded at the foot. `?by=<id>` keeps it to the
 * threads one thread started.
 */
export function ThreadList() {
	const { model, units, feed, isLoading } = useThreadListModel();
	const asks = useAsksByThread();
	const openSearch = useOpenSearch();
	const now = useNow(30_000) ?? 0;
	const { pathname, search } = useLocation();
	const settle = useSettleThread();
	const { undo, settle: onSettle, restore } = useSettleUndo(settle.mutate);
	const said = useAnnouncer(units);
	const listRef = useRef<HTMLDivElement>(null);
	useRowKeys(listRef, 'a[data-testid="thread-row"]');
	const investigation = (search as { investigation?: string }).investigation;
	const by = (search as { by?: string }).by;
	const navigate = useNavigate();
	const currentId =
		investigation ??
		/^\/threads\/([0-9a-f-]{36})/.exec(pathname)?.[1] ??
		/\/runs\/([0-9a-f-]{36})/.exec(pathname)?.[1] ??
		null;

	if (isLoading)
		return (
			<div className="flex flex-col gap-1 px-4 pt-2.5" aria-busy>
				<div className="shimmer mb-1 h-3 w-1/2 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
			</div>
		);
	if (feed.isError && units.length === 0)
		return (
			<p
				className="px-4 py-2 text-meta text-danger"
				data-testid="threads-failed"
			>
				Threads did not load
			</p>
		);
	const hidden = undo?.id;
	const shown: ThreadListModel = hidden
		? {
				...model,
				active: model.active.filter((n) => n.id !== hidden),
				needs: model.needs.filter((n) => n.id !== hidden),
			}
		: model;
	return (
		<div
			ref={listRef}
			className="flex flex-col gap-3 px-2"
			data-testid="thread-list"
		>
			<div role="status" aria-live="polite" className="sr-only">
				{said}
			</div>
			{undo && (
				<div
					className="flex h-7 items-center gap-2 px-2.5 text-meta text-text-2"
					data-testid="settle-undo-line"
				>
					<span className="min-w-0 truncate">Settled {undo.title}</span>
					<button
						type="button"
						// Until Settle answers there is nothing exact to restore (#1020).
						disabled={!undo.previous || undo.restoring}
						onClick={restore}
						className="ml-auto shrink-0 rounded-control px-1.5 font-medium text-text-1 hover:bg-surface-3 disabled:text-text-3"
						data-testid="settle-undo"
					>
						Undo
					</button>
				</div>
			)}
			{by && (
				<StartedByFilter
					title={starterTitle(model, by)}
					onClear={() =>
						void navigate({
							to: ".",
							search: (prev: Record<string, unknown>) => {
								const { by: _, ...rest } = prev;
								return rest;
							},
						} as never)
					}
				/>
			)}
			<ThreadTreeView
				model={shown}
				{...(by
					? { filter: (n: ListNode) => n.thread.startedBy?.id === by }
					: {})}
				asks={asks}
				now={now}
				currentId={currentId}
				onSettle={onSettle}
				onMoreSettled={() => {
					if (feed.hasNextPage) void feed.fetchNextPage();
				}}
			/>
			<button
				type="button"
				onClick={openSearch}
				className="flex h-7 items-center rounded-control px-2.5 text-left text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
				data-testid="threads-view-all"
			>
				Search threads
			</button>
		</div>
	);
}

/** The starter's title from any loaded row: its own, or what a row it started says. */
function starterTitle(model: ThreadListModel, id: string): string | null {
	const all = [
		...model.needs,
		...model.pinned,
		...model.active,
		...model.settled,
	];
	return (
		all.find((n) => n.id === id)?.thread.title ??
		all.find((n) => n.thread.startedBy?.id === id)?.thread.startedBy?.title ??
		null
	);
}

/** The list kept to one starter's threads: its mark and title, and a clear (#1101 cat 1). */
function StartedByFilter({
	title,
	onClear,
}: {
	title: string | null;
	onClear: () => void;
}) {
	return (
		<div
			className="flex h-7 items-center gap-1.5 rounded-control bg-surface-2 px-2.5 text-meta text-text-2"
			data-testid="started-by-filter"
		>
			<StartedByMark by={{ title, via: "agent" }} />
			<span className="min-w-0 flex-1 truncate">{title ?? "A thread"}</span>
			<Hint label="Show every thread">
				<button
					type="button"
					aria-label="Show every thread"
					onClick={onClear}
					className="flex size-5 shrink-0 items-center justify-center rounded-control text-text-3 hover:bg-surface-3 hover:text-text-1"
					data-testid="started-by-filter-clear"
				>
					<X aria-hidden className="size-3" />
				</button>
			</Hint>
		</div>
	);
}

export function isOn(r: ThreadRow, pathname: string, investigation?: string) {
	if (r.incidentId) return pathname.startsWith(`/incidents/${r.incidentId}`);
	const id = r.thread.id;
	return (
		pathname === `/threads/${id}` ||
		pathname.endsWith(`/runs/${id}`) ||
		investigation === id
	);
}

/** One thread: its title, then what started it and what it is doing, in words. */
export function ThreadRowView({
	row,
	now,
	on,
	detailed = false,
	onSettle,
}: {
	row: ThreadRow;
	now: number;
	on: boolean;
	/** Two lines with origin and state in words, for the Threads page; the sidebar keeps one line. */
	detailed?: boolean;
	/** Rename, Stop and Settle on hover: the sidebar's rows only. */
	onSettle?: (t: FeedRow) => void;
}) {
	const [renaming, setRenaming] = useState(false);
	const cancel = useCancelInvestigation();
	if (renaming)
		return (
			<RenameField
				id={row.thread.id}
				title={row.title}
				onDone={() => setRenaming(false)}
			/>
		);
	const origin = ORIGIN_WORD[row.origin];
	const body = !detailed ? (
		<>
			<span dir="auto" className="min-w-0 flex-1 truncate">
				{row.title}
			</span>
			<RowMark row={row} now={now} hideOnHover={!!onSettle} />
		</>
	) : (
		<>
			<span className="flex min-w-0 items-baseline gap-3">
				<span
					dir="auto"
					className="min-w-0 flex-1 truncate text-body text-text-1"
				>
					{row.title}
				</span>
				<span
					className="shrink-0 text-meta text-text-3 tabular-nums"
					data-testid="row-when"
				>
					{now ? rowWhen(row.at, now) : null}
				</span>
			</span>
			<span className="flex min-w-0 items-center gap-1.5 text-meta text-text-3">
				<span data-testid="row-origin" className="shrink-0">
					{origin ?? "Chat"}
					{row.firing && <span className="text-danger"> firing</span>}
				</span>
				{row.state ? (
					<>
						<span aria-hidden>·</span>
						<span
							className={cn(
								"flex shrink-0 items-center gap-1",
								STATE_TONE[row.state],
							)}
							data-testid="tree-state"
							data-state={row.state}
						>
							{row.state === "working" && <Ring />}
							{STATE_WORD[row.state]}
							{row.state === "working" && row.live && now
								? ` ${formatElapsed(runElapsed(row.live, now))}`
								: null}
						</span>
					</>
				) : (
					row.incidentClosed && (
						<>
							<span aria-hidden>·</span>
							<span className="shrink-0">Resolved</span>
						</>
					)
				)}
				{row.service && (
					<>
						<span aria-hidden>·</span>
						<span className="min-w-0 truncate">{row.service}</span>
					</>
				)}
			</span>
		</>
	);
	const live = isWorkflowLive(row.thread.status);
	return (
		<div className="group/row relative" data-testid="thread-row-wrap">
			<Link
				{...row.link}
				aria-current={on ? "page" : undefined}
				className={cn(
					"flex min-w-0 rounded-control px-2.5 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 focus-visible:bg-surface-3",
					detailed
						? "flex-col justify-center gap-0.5 py-1.5"
						: "h-8 items-center gap-2 text-body hover:bg-surface-2",
					on && "bg-surface-3 font-medium text-text-1 hover:bg-surface-3",
				)}
				data-testid="thread-row"
				data-id={row.thread.id}
				data-state={row.state ?? "quiet"}
			>
				{body}
			</Link>
			{onSettle && (
				<div className="absolute top-1 right-1 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex">
					<RowAction
						label="Rename"
						onClick={() => setRenaming(true)}
						testId="thread-rename"
					>
						<Pencil className="size-3" />
					</RowAction>
					{live ? (
						<RowAction
							label="Stop"
							onClick={() => cancel.mutate({ id: row.thread.id })}
							testId="thread-stop"
						>
							<Square className="size-3" />
						</RowAction>
					) : (
						<RowAction
							label="Settle: ends this thread's watches and schedules"
							onClick={() => onSettle(row.thread)}
							testId="thread-settle"
						>
							<Check className="size-3.5" />
						</RowAction>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * The sidebar row's one trailing mark, in a fixed 16 px slot (#1020): a
 * status dot, a small ring while working, else a muted origin glyph. The words
 * live in the hint and for screen readers.
 */
function RowMark({
	row,
	now,
	hideOnHover,
}: {
	row: ThreadRow;
	now: number;
	/** The row's actions take the slot on hover. */
	hideOnHover: boolean;
}) {
	const origin = ORIGIN_WORD[row.origin];
	const words = [
		origin && `${origin}${row.firing ? ", firing" : ""}`,
		row.state && STATE_WORD[row.state],
		row.state === "working" && row.live && now
			? formatElapsed(runElapsed(row.live, now))
			: null,
	]
		.filter(Boolean)
		.join(", ");
	if (!words) return null;
	let mark: ReactNode = null;
	if (row.state === "failed")
		mark = <span className="block size-1.5 rounded-full bg-danger" />;
	else if (row.state === "ready" || row.state === "new")
		mark = <span className="block size-1.5 rounded-full bg-accent" />;
	else if (row.state === "asks")
		mark = <span className="block size-1.5 rounded-full bg-warn" />;
	else if (row.state === "limited")
		mark = <Clock3 className="size-3 stroke-[1.75] text-warn" />;
	else if (row.state === "working") mark = <Ring />;
	else if (origin) {
		const Icon = TRIGGER_ICON[row.origin];
		mark = <Icon className="size-3 stroke-[1.75] text-text-3" />;
	}
	return (
		<Hint label={words} side="right">
			<span
				className={cn(
					"flex w-4 shrink-0 items-center justify-center",
					hideOnHover &&
						"group-focus-within/row:invisible group-hover/row:invisible",
				)}
				data-testid={row.state ? "tree-state" : "row-origin"}
				data-state={row.state ?? undefined}
			>
				<span aria-hidden className="flex items-center">
					{mark}
				</span>
				<span className="sr-only">, {words}</span>
			</span>
		</Hint>
	);
}

function RowAction({
	label,
	onClick,
	testId,
	children,
}: {
	label: string;
	onClick: () => void;
	testId: string;
	children: ReactNode;
}) {
	return (
		<Hint label={label} side="top">
			<button
				type="button"
				aria-label={label}
				onClick={onClick}
				className="flex size-6 items-center justify-center rounded-control bg-surface-3 text-text-2 hover:bg-surface-4 hover:text-text-1"
				data-testid={testId}
			>
				{children}
			</button>
		</Hint>
	);
}

/** How many alerts landed with no service to map them to: the sidebar's Alerts door. */
export function useUnmappedAlerts(enabled = true): number {
	const { data } = useQuery({
		...orpc.alerts.list.queryOptions({ input: { unassigned: true, limit: 1 } }),
		enabled,
	});
	return data?.pagination.total ?? 0;
}

/** Reads background moves into Needs you or Settled; the first read says nothing. */
function useAnnouncer(units: ThreadUnit[]): string {
	const before = useRef<Map<string, FeedRow["section"]> | null>(null);
	const [said, setSaid] = useState("");
	useEffect(() => {
		const next = sectionsOf(units);
		if (before.current) {
			const lines = announcements(before.current, units);
			if (lines.length) setSaid(lines.join(". "));
		}
		before.current = next;
	}, [units]);
	return said;
}
