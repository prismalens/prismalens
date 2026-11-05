// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isAlertFiring,
	isWorkflowLive,
	type Schedule,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Bell, CalendarClock, User, Webhook } from "lucide-react";
import { needOf } from "@/components/inbox/inbox-model";
import {
	useActiveIncidents,
	useRecentlyResolved,
} from "@/components/inbox/use-inbox-data";
import { runElapsed } from "@/components/incidents/run-facts";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { useNow } from "@/hooks/use-now";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { formatElapsed } from "@/lib/format-time";
import { rowWhen } from "@/lib/thread-groups";
import { readableTitle } from "@/lib/title";
import {
	isPlainChat,
	TRIGGER_WORD,
	type TriggerKind,
	triggerOf,
} from "@/lib/trigger";
import { cn } from "@/lib/utils";
import { rowStateOf } from "./IncidentTree";

type State = "asks" | "failed" | "working" | "ready" | null;

/** One row: an incident's thread or a schedule's latest run, the same shape either way. */
export interface ThreadRow {
	key: string;
	title: string;
	origin: TriggerKind;
	state: State;
	section: "needs" | "active" | "settled";
	hint: string;
	/** The alert's own state, apart from the agent's: firing until it clears (D18). */
	firing?: boolean;
	at: number;
	incident?: IncidentWithRelations;
	schedule?: { id: string; runId: string };
	/** The live run, for the working time and the ask answered from the row. */
	live?: {
		id: string;
		status: string;
		startedAt: string | null;
		createdAt: string;
	};
}

/** One mark per trigger kind; the row, the trigger card and Home share it. */
export const TRIGGER_ICON = {
	you: User,
	alert: Bell,
	webhook: Webhook,
	schedule: CalendarClock,
} as const;
const SECTIONS = [
	{ id: "needs", label: "Needs you" },
	{ id: "active", label: "Working" },
	{ id: "settled", label: "Done" },
] as const;
const RANK: Record<NonNullable<State> | "none", number> = {
	asks: 0,
	failed: 1,
	ready: 2,
	working: 3,
	none: 4,
};

const time = (at: string | null | undefined) => (at ? Date.parse(at) : 0);
/** Rows a section shows before "N more"; the rest are one click away. */
const PER_SECTION = 8;

export function incidentRow(
	incident: IncidentWithRelations,
	resolved = false,
): ThreadRow {
	const live = (incident.investigations ?? []).find((r) =>
		isWorkflowLive(r.status),
	);
	const state = resolved ? null : rowStateOf(incident);
	const service = incident.service?.displayName || incident.service?.name;
	const origin = triggerOf(incident).kind;
	return {
		key: `i-${incident.id}`,
		title: origin === "you" ? incident.title : readableTitle(incident.title),
		origin,
		state,
		section: resolved
			? "settled"
			: needOf(incident) !== null
				? "needs"
				: live || !isPlainChat(incident)
					? "active"
					: "settled",
		hint: [
			isPlainChat(incident) ? null : `INC-${incident.number}`,
			service,
			TRIGGER_WORD[origin],
		]
			.filter(Boolean)
			.join(", "),
		at: time(incident.updatedAt ?? incident.triggeredAt),
		// A webhook delivery is an event, not a condition: only alerts fire.
		firing:
			origin === "alert" &&
			!resolved &&
			(incident.alerts ?? []).some((a) => isAlertFiring(a.status)),
		incident,
		...(live
			? {
					live: {
						id: live.id,
						status: live.status,
						startedAt: live.startedAt ?? null,
						createdAt: live.createdAt,
					},
				}
			: {}),
	};
}

/** A schedule's latest run; nothing to show for one that has not run. */
export function scheduleRow(s: Schedule): ThreadRow | null {
	const runId = s.liveRunId ?? s.lastTick?.run?.id;
	if (!runId) return null;
	const status = s.liveRunId ? "running" : (s.lastTick?.run?.status ?? "");
	const failed = status === "failed";
	return {
		key: `s-${s.id}`,
		title: s.name,
		origin: "schedule",
		state: s.liveRunId ? "working" : failed ? "failed" : null,
		section: s.liveRunId ? "active" : failed ? "needs" : "settled",
		hint: [s.serviceName, s.description, TRIGGER_WORD.schedule].join(", "),
		at: time(s.lastTick?.decidedAt),
		schedule: { id: s.id, runId },
	};
}

/** Most urgent first inside a section, then the newest. */
export function sortRows(rows: ThreadRow[]): ThreadRow[] {
	return [...rows].sort(
		(a, b) => RANK[a.state ?? "none"] - RANK[b.state ?? "none"] || b.at - a.at,
	);
}

/** What started a thread, in a word; a thread you started needs none (D18). */
export const ORIGIN_WORD: Record<TriggerKind, string | null> = {
	you: null,
	alert: "Alert",
	webhook: "Webhook",
	schedule: "Scheduled",
};
/** What a thread's agent work is doing, in words, never a lone glyph (D18). */
export const STATE_WORD: Record<NonNullable<State>, string> = {
	asks: "Approval needed",
	failed: "Failed",
	working: "Working",
	ready: "Likely cause",
};
const STATE_TONE: Record<NonNullable<State>, string> = {
	asks: "text-warn",
	failed: "text-danger",
	working: "text-text-2",
	ready: "text-accent",
};
/** Recents rows before View all. */
const RECENT = 12;
/** Waiting threads shown before View all. */
const WAITING = 3;

/** Every thread, whoever started it: incidents, chats and schedule runs. */
export function useThreadRows(resolvedLimit = 5) {
	const { incidents, isLoading } = useActiveIncidents();
	const recent = useRecentlyResolved(resolvedLimit);
	const schedules = useQuery({
		...orpc.schedules.list.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
	const rows = [
		...incidents.map((i) => incidentRow(i)),
		...recent.rows.map((i) => incidentRow(i, true)),
		...(schedules.data?.schedules ?? [])
			.map(scheduleRow)
			.filter((r): r is ThreadRow => r !== null),
	];
	return { rows, isLoading };
}

/**
 * The sidebar's list (D18): Waiting for you (approvals and questions, any
 * origin), then Recents by last activity. A waiting thread shows once, above.
 */
export function ThreadList() {
	const { rows, isLoading } = useThreadRows();
	const now = useNow(30_000) ?? 0;
	const { pathname } = useLocation();

	if (isLoading)
		return (
			<div className="flex flex-col gap-1 px-4 pt-2.5" aria-busy>
				<div className="shimmer mb-1 h-3 w-1/2 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
				<div className="shimmer h-5 rounded-[4px]" />
			</div>
		);
	if (rows.length === 0)
		return (
			<section aria-label="Recents" className="flex flex-col gap-px px-2">
				<h2 className="flex h-7 items-center px-2.5 text-meta text-text-3">
					Recents
				</h2>
				<p
					className="px-2.5 py-1 text-body text-text-3"
					data-testid="tree-empty"
				>
					No threads yet
				</p>
			</section>
		);
	const waiting = rows
		.filter((r) => r.state === "asks")
		.sort((a, b) => a.at - b.at);
	const recents = rows
		.filter((r) => r.state !== "asks")
		.sort((a, b) => b.at - a.at);
	return (
		<div className="flex flex-col gap-3 px-2" data-testid="thread-list">
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
					{waiting.slice(0, WAITING).map((r) => (
						<ThreadRowView key={r.key} row={r} now={now} pathname={pathname} />
					))}
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
				{recents.slice(0, RECENT).map((r) => (
					<ThreadRowView key={r.key} row={r} now={now} pathname={pathname} />
				))}
				<Link
					to="/threads"
					className="flex h-7 items-center px-2.5 text-meta text-text-3 hover:text-text-1"
					data-testid="threads-view-all"
				>
					View all
				</Link>
			</section>
		</div>
	);
}

/** One thread: its title, then what started it and what it is doing, in words. */
export function ThreadRowView({
	row,
	now,
	pathname,
	detailed = false,
}: {
	row: ThreadRow;
	now: number;
	pathname: string;
	/** Two lines with origin and state in words, for the Threads page; the sidebar keeps one line. */
	detailed?: boolean;
}) {
	const on = row.incident
		? pathname.startsWith(`/incidents/${row.incident.id}`)
		: !!row.schedule &&
			pathname.startsWith(`/schedules/${row.schedule.id}/runs/`);
	const origin = ORIGIN_WORD[row.origin];
	const service =
		row.incident?.service?.displayName || row.incident?.service?.name;
	const body = !detailed ? (
		<>
			<span dir="auto" className="min-w-0 flex-1 truncate">
				{row.title}
			</span>
			<RowMark row={row} now={now} />
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
					row.incident?.status === "closed" && (
						<>
							<span aria-hidden>·</span>
							<span className="shrink-0">Resolved</span>
						</>
					)
				)}
				{service && (
					<>
						<span aria-hidden>·</span>
						<span className="min-w-0 truncate">{service}</span>
					</>
				)}
			</span>
		</>
	);
	const cls = cn(
		"flex min-w-0 rounded-control px-2.5 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1",
		detailed
			? "flex-col justify-center gap-0.5 py-1.5"
			: "h-8 items-center gap-2 text-body hover:bg-surface-2",
		on && "bg-surface-3 font-medium text-text-1 hover:bg-surface-3",
	);
	if (row.incident)
		return isPlainChat(row.incident) ? (
			<Link
				to="/incidents/$id/conversation"
				params={{ id: row.incident.id }}
				aria-current={on ? "page" : undefined}
				className={cls}
				data-testid="tree-incident-link"
			>
				{body}
			</Link>
		) : (
			<Link
				to="/incidents/$id"
				params={{ id: row.incident.id }}
				aria-current={on ? "page" : undefined}
				className={cls}
				data-testid="tree-incident-link"
			>
				{body}
			</Link>
		);
	return (
		<Link
			to="/schedules/$id/runs/$runId"
			params={{ id: row.schedule?.id ?? "", runId: row.schedule?.runId ?? "" }}
			aria-current={on ? "page" : undefined}
			className={cls}
			data-testid="tree-schedule-link"
		>
			{body}
		</Link>
	);
}

/**
 * The sidebar row's one trailing mark, in a fixed 16 px slot (cp5 look): a
 * status dot, a small ring while working, else a muted origin glyph. The words
 * live in the hint and for screen readers.
 */
function RowMark({ row, now }: { row: ThreadRow; now: number }) {
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
	let mark: React.ReactNode = null;
	if (row.state === "failed")
		mark = <span className="block size-1.5 rounded-full bg-danger" />;
	else if (row.state === "ready")
		mark = <span className="block size-1.5 rounded-full bg-accent" />;
	else if (row.state === "working") mark = <Ring />;
	else if (origin) {
		const Icon = TRIGGER_ICON[row.origin];
		mark = <Icon className="size-3 stroke-[1.75] text-text-3" />;
	}
	return (
		<Hint label={words} side="right">
			<span
				className="flex w-4 shrink-0 items-center justify-center"
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
