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
import { Link, useLocation } from "@tanstack/react-router";
import {
	Bell,
	BellRing,
	CalendarClock,
	Check,
	Pencil,
	Square,
	User,
	Webhook,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { runElapsed } from "@/components/incidents/run-facts";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Input } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import { useRowKeys } from "@/hooks/use-row-keys";
import { useSettleUndo } from "@/hooks/use-settle-undo";
import { useCancelInvestigation } from "@/lib/api/hooks";
import {
	type ThreadFeedInput,
	useRenameThread,
	useSettleThread,
	useThreadFeed,
} from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatElapsed } from "@/lib/format-time";
import { rowWhen } from "@/lib/thread-groups";
import {
	announcements,
	rowState,
	sectionsOf,
	type ThreadLink,
	threadLink,
} from "@/lib/thread-rows";
import { readableTitle } from "@/lib/title";
import {
	isPlainChat,
	TRIGGER_WORD,
	type TriggerKind,
	triggerOf,
} from "@/lib/trigger";
import { cn } from "@/lib/utils";

type State = "asks" | "failed" | "working" | "ready" | "new" | null;

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

/** The one state a unit shows: an ask outranks a failure, a run, a finding, news. */
export function unitState(threads: FeedRow[]): State {
	const states = threads.map(rowState);
	if (states.includes("ask")) return "asks";
	if (states.includes("failed")) return "failed";
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
			: chip && first.triggerType && first.triggerType !== "manual"
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
			chip && !chat ? `INC-${chip.number}` : null,
			service,
			TRIGGER_WORD[origin],
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
	working: "Working",
	ready: "Likely cause",
	new: "New",
};
const STATE_TONE: Record<NonNullable<State>, string> = {
	asks: "text-warn",
	failed: "text-danger",
	working: "text-text-2",
	ready: "text-accent",
	new: "text-accent",
};
/** Recents rows before View all. */
const RECENT = 12;
/** Waiting threads shown before View all. */
const WAITING = 3;

/** Every thread, whoever started it, as rows: the feed joined to open incidents. */
export function useThreadRows(input: ThreadFeedInput = {}) {
	const feed = useThreadFeed(input);
	const { incidents } = useActiveIncidents();
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

/** How many threads wait on an approval: the rail's and the phone strip's count. */
export function useWaitingCount(): number {
	const { rows } = useThreadRows();
	return rows.filter((r) => r.state === "asks").length;
}

/**
 * The sidebar's list (#1020): Waiting for you (approvals and questions, any
 * origin), then Recents by last activity. A waiting thread shows once, above.
 */
export function ThreadList() {
	const { rows, units, feed, isLoading } = useThreadRows();
	const now = useNow(30_000) ?? 0;
	const { pathname, search } = useLocation();
	const settle = useSettleThread();
	const { undo, settle: onSettle, restore } = useSettleUndo(settle.mutate);
	const said = useAnnouncer(units);
	const listRef = useRef<HTMLDivElement>(null);
	useRowKeys(listRef, 'a[data-testid="thread-row"]');
	const investigation = (search as { investigation?: string }).investigation;

	if (isLoading)
		return (
			<div className="flex flex-col gap-1 px-4 pt-2.5" aria-busy>
				<div className="shimmer mb-1 h-3 w-1/2 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
			</div>
		);
	if (feed.isError && rows.length === 0)
		return (
			<p
				className="px-4 py-2 text-meta text-danger"
				data-testid="threads-failed"
			>
				Threads did not load
			</p>
		);
	const waiting = rows
		.filter((r) => r.state === "asks")
		.sort((a, b) => a.at - b.at);
	const recents = rows
		.filter((r) => r.state !== "asks" && r.thread.id !== undo?.id)
		.sort((a, b) => b.at - a.at);
	const row = (r: ThreadRow) => (
		<ThreadRowView
			key={r.key}
			row={r}
			now={now}
			on={isOn(r, pathname, investigation)}
			onSettle={onSettle}
		/>
	);
	return (
		<div
			ref={listRef}
			className="flex flex-col gap-3 px-2"
			data-testid="thread-list"
		>
			<div role="status" aria-live="polite" className="sr-only">
				{said}
			</div>
			<UnmappedAlertsRow />
			{waiting.length > 0 && (
				<section
					aria-label="Waiting for you"
					className="flex flex-col gap-px"
					data-testid="thread-section-waiting"
				>
					<h2 className="flex h-7 items-center px-2.5 text-meta text-text-3">
						Waiting for you
						<span className="ml-auto text-warn tabular-nums">
							{waiting.length}
						</span>
					</h2>
					{waiting.slice(0, WAITING).map(row)}
					{waiting.length > WAITING && (
						<Link
							to="/threads"
							search={{ state: "waiting" }}
							className="flex h-6 items-center px-2.5 text-meta text-accent hover:underline"
						>
							{waiting.length} threads waiting. View all
						</Link>
					)}
				</section>
			)}
			<section
				aria-label="Recents"
				className="flex flex-col gap-px"
				data-testid="thread-section-recents"
			>
				<h2 className="flex h-7 items-center gap-2 px-2.5 text-meta text-text-3">
					Recents
				</h2>
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
				{rows.length === 0 ? (
					<p
						className="px-2.5 py-1 text-body text-text-3"
						data-testid="threads-empty"
					>
						No threads yet
					</p>
				) : (
					<>
						{recents.slice(0, RECENT).map(row)}
						<Link
							to="/threads"
							className="flex h-7 items-center px-2.5 text-meta text-text-3 hover:text-text-1"
							data-testid="threads-view-all"
						>
							View all
						</Link>
					</>
				)}
			</section>
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
			<RenameRow
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
							label="Settle"
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

/** The row as a field: Enter keeps the name, Esc or leaving it drops the edit. */
function RenameRow({
	id,
	title,
	onDone,
}: {
	id: string;
	title: string;
	onDone: () => void;
}) {
	const rename = useRenameThread();
	const [value, setValue] = useState(title);
	const save = () => {
		const next = value.trim();
		if (next && next !== title) rename.mutate({ id, title: next });
		onDone();
	};
	return (
		<form
			className="px-1 py-0.5"
			onSubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<Input
				// biome-ignore lint/a11y/noAutofocus: the field opens only from its own Rename button.
				autoFocus
				value={value}
				maxLength={80}
				onChange={(e) => setValue(e.target.value)}
				onBlur={onDone}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onDone();
					}
				}}
				aria-label="Thread name"
				dir="auto"
				className="h-8"
				data-testid="thread-rename-input"
			/>
		</form>
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

/** Only when some alerts landed with no service to map them to. */
function UnmappedAlertsRow() {
	const { data } = useQuery(
		orpc.alerts.list.queryOptions({ input: { unassigned: true, limit: 1 } }),
	);
	const n = data?.pagination.total ?? 0;
	if (n === 0) return null;
	return (
		<Link
			to="/alerts"
			search={{ tab: "unmapped" }}
			className="flex h-7 items-center gap-2 rounded-control px-2.5 text-meta text-text-2 hover:bg-surface-3 hover:text-text-1"
			data-testid="unmapped-alerts-row"
		>
			<BellRing aria-hidden className="size-3.5 text-warn" />
			<span>
				{n.toLocaleString("en-US")} {n === 1 ? "alert" : "alerts"} unmapped
			</span>
		</Link>
	);
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
