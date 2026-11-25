// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Home's away view (#1101 category 3): what changed while the operator was away,
 * one flat card per thread, from the server's read state so every
 * device shows the same list. Each thread is a kit list card that words its
 * outcome; after a long gap a card also answers its ask in place.
 */
import type {
	AttentionEvent,
	AttentionKind,
	AttentionThread,
	AwayView as AwayData,
	ThreadStatus,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ListCard, ListGrid } from "@/components/kit/ListCard";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { Status, statusUrgency } from "@/components/kit/Status";
import { Time } from "@/components/kit/Time";
import { Hint } from "@/components/shared/Hint";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useThreadAsks } from "@/lib/api/hooks/use-threads-orpc";
import { eventWords, threadName } from "@/lib/attention/notify-rules";
import { useAwayView, useMarkEventsRead } from "@/lib/attention/use-attention";
import { formatDayClock } from "@/lib/format-time";
import { severityWord, threadLink } from "@/lib/thread-rows";
import { ageWord } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

/** The mark an event draws: the status it moved the thread to. */
export function kindStatus(
	kind: AttentionKind,
	now: ThreadStatus | null,
): ThreadStatus {
	switch (kind) {
		case "needs_you":
			return now === "question" ? "question" : "approval";
		case "limited":
			return "limited";
		case "blocked":
			return "blocked";
		case "failed":
			return "failed";
		case "finished":
			return "done";
		case "started":
			return "working";
	}
}

export function AwayView({
	fold,
	skip,
}: {
	fold?: boolean;
	/** Threads shown elsewhere on the page (Home's Needs you): left out here. */
	skip?: ReadonlySet<string>;
} = {}) {
	const away = useAwayView();
	const asks = useThreadAsks(!!away.data?.long);
	const markRead = useMarkEventsRead();
	const [open, setOpen] = useState(false);
	const latest = away.data ? onePerIncident(away.data) : undefined;
	const data =
		latest && skip
			? {
					...latest,
					groups: latest.groups
						.map((g) => ({
							...g,
							threads: g.threads.filter((t) => !skip.has(t.thread.id)),
						}))
						.filter((g) => g.threads.length > 0),
				}
			: latest;
	if (!data || data.groups.length === 0) return null;
	// Home stays a clean page (sheet §1): the list opens only when asked.
	if (fold && !open)
		return (
			<AwayFold data={data} now={Date.now()} onOpen={() => setOpen(true)} />
		);
	return (
		<AwayList
			data={data}
			asks={asks.data?.asks ?? []}
			now={Date.now()}
			onMarkAll={() => markRead.mutate({})}
			marking={markRead.isPending}
		/>
	);
}

/** Lines the digest shows before "N more"; Events holds the rest. */
const DIGEST_LINES = 5;

/**
 * Home's what-changed (#1101 cat 3): a line per thread with its outcome mark,
 * words and age, each opening its thread; the heading's Since link and "N more"
 * open the full list.
 */
export function AwayDigest() {
	const away = useAwayView();
	const now = useNow(30_000);
	if (!away.data) return null;
	const lines = digestLines(away.data);
	if (lines.length === 0) return null;
	return <AwayDigestCard since={away.data.since} lines={lines} now={now} />;
}

export interface DigestLine {
	id: string;
	/** An alert thread opens inside its incident, as every other thread link does. */
	incidentId: string | null;
	title: string;
	status: ThreadStatus;
	detail: string | null;
	at: string;
}

/**
 * An incident whose run failed and was retried has two threads; it reads once, as the
 * thread with the newest event. A thread with no incident is its own.
 */
export function onePerIncident(data: AwayData): AwayData {
	const winner = new Map<string, string>();
	const best = new Map<string, number>();
	for (const { thread, events } of data.groups.flatMap((g) => g.threads)) {
		const key = thread.incident?.id ?? thread.id;
		const at = Math.max(...events.map((e) => Date.parse(e.at)), 0);
		if (at >= (best.get(key) ?? -1)) {
			best.set(key, at);
			winner.set(key, thread.id);
		}
	}
	return {
		...data,
		groups: data.groups
			.map((g) => ({
				...g,
				threads: g.threads.filter(
					(t) =>
						winner.get(t.thread.incident?.id ?? t.thread.id) === t.thread.id,
				),
			}))
			.filter((g) => g.threads.length > 0),
	};
}

/** Each changed thread once, at the event matching its status now; newest first. */
export function digestLines(data: AwayData): DigestLine[] {
	return onePerIncident(data)
		.groups.flatMap((g) => g.threads)
		.flatMap(({ thread, events }) => {
			const lead = currentEvent(events, thread.status);
			if (!lead) return [];
			return [
				{
					id: thread.id,
					incidentId: thread.incident?.id ?? null,
					title: threadName(thread),
					status: kindStatus(lead.kind, thread.status),
					detail: eventWords(lead).detail,
					at: lead.at,
				},
			];
		})
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function AwayDigestCard({
	since,
	lines,
	now,
}: {
	since: string | null;
	lines: DigestLine[];
	now: number | null;
}) {
	const shown = lines.slice(0, DIGEST_LINES);
	const tally = new Map<ThreadStatus, number>();
	for (const l of lines) tally.set(l.status, (tally.get(l.status) ?? 0) + 1);
	const bands = Array.from(tally).sort(
		([a], [b]) => statusUrgency(a) - statusUrgency(b),
	);
	return (
		<section
			aria-label="What changed"
			className="flex flex-col gap-1.5 rounded-surface bg-surface-1 px-3 py-2.5"
			data-testid="away-digest"
		>
			<span className="flex min-w-0 items-center gap-3">
				<h2 className="text-heading text-text-1">What changed</h2>
				<span className="flex items-center gap-2.5">
					{bands.map(([status, n]) => (
						<span
							key={status}
							className="inline-flex items-center gap-1 text-meta text-text-2 tabular-nums"
							data-band={status}
						>
							<Status kind={status} showWord={false} />
							{n}
						</span>
					))}
				</span>
				{/* Each row opens its own thread; the full list is this one link (#1101 cat 3). */}
				<Link
					to="/events"
					className="ml-auto flex min-h-8 items-center gap-1 rounded-control px-1.5 text-meta text-text-3 outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11"
					data-testid="away-digest-link"
				>
					{since && <Time at={since} now={now} prefix="Since" past />}
					<span className="sr-only">, all changes</span>
					<ChevronRight aria-hidden className="size-3.5" />
				</Link>
			</span>
			<ul className="flex flex-col">
				{shown.map((l) => (
					<li key={l.id}>
						{/* The thread opens at its first unseen event, which is this change. */}
						<Link
							{...threadLink({
								id: l.id,
								incidentId: l.incidentId,
								scheduleId: null,
							})}
							className="-mx-1.5 grid min-w-0 grid-cols-[auto_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-2 rounded-control px-1.5 py-0.5 text-meta outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11 max-sm:grid-cols-[auto_minmax(0,1fr)_auto]"
							data-testid="away-line"
							data-state={l.status}
						>
							<Status kind={l.status} showWord={false} />
							<span dir="auto" className="truncate text-body text-text-1">
								{l.title}
							</span>
							<span dir="auto" className="truncate text-text-3 max-sm:hidden">
								{l.detail}
							</span>
							<span className="text-text-3 tabular-nums">
								{now === null ? "" : ageWord(Date.parse(l.at), now)}
							</span>
						</Link>
					</li>
				))}
			</ul>
			{lines.length > shown.length && (
				<Link
					to="/events"
					className="flex min-h-7 items-center self-start rounded-control px-1.5 -mx-1.5 text-meta text-text-3 outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11"
					data-testid="away-more"
				>
					{lines.length - shown.length} more
				</Link>
			)}
		</section>
	);
}

/** The folded view: one line with the heading and how many threads changed. */
export function AwayFold({
	data,
	now,
	onOpen,
}: {
	data: AwayData;
	now: number;
	onOpen: () => void;
}) {
	const n = data.groups.reduce((sum, g) => sum + g.threads.length, 0);
	const words = `${n} ${n === 1 ? "thread" : "threads"} changed${data.since ? ` since ${formatDayClock(data.since, now)}` : ""}`;
	const look = markLook("away");
	// A mark and its count; the words ride in the hint and the label (#1101).
	return (
		<Hint label={words}>
			<button
				type="button"
				aria-expanded={false}
				aria-label={words}
				onClick={onOpen}
				className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-control px-2 text-body text-text-2 tabular-nums outline-none hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="away-fold"
			>
				<look.icon aria-hidden className={cn("size-3.5", look.className)} />
				{n}
				<ChevronDown aria-hidden className="size-3.5 text-text-3" />
			</button>
		</Hint>
	);
}

/** The view itself, from data, for the gallery and tests. */
export function AwayList({
	data,
	asks,
	now,
	onMarkAll,
	marking,
}: {
	data: AwayData;
	asks: RowAskEntry[];
	now: number;
	onMarkAll: () => void;
	marking?: boolean;
}) {
	return (
		<section
			className="flex w-full flex-col gap-3"
			aria-label="While you were away"
			data-testid="away-view"
			data-long={data.long ? "" : undefined}
		>
			<div className="flex items-center gap-3">
				<h2 className="text-heading text-text-1">
					{data.since
						? `Since ${formatDayClock(data.since, now)}`
						: "What changed"}
				</h2>
				<Link
					to="/events"
					className="ml-auto flex h-7 items-center rounded-control px-2 text-meta text-text-2 hover:bg-surface-2 hover:text-text-1"
					data-testid="away-all-events"
				>
					All changes
				</Link>
				<Button
					variant="text"
					size="sm"
					onClick={onMarkAll}
					disabled={marking}
					data-testid="away-mark-all"
				>
					Mark all read
				</Button>
			</div>
			{/* Threads are flat siblings: every changed thread is its own card, never under its starter (#1101). */}
			<ListGrid label="What changed">
				{data.groups
					.flatMap((g) => g.threads)
					.map(({ thread, events }) => (
						<AwayCard
							key={thread.id}
							thread={thread}
							events={events}
							ask={
								data.long
									? asks.filter((a) => a.ask.threadId === thread.id)
									: []
							}
							now={now}
							testId={data.long ? "away-card" : "away-line"}
						/>
					))}
			</ListGrid>
		</section>
	);
}

/**
 * The one event a thread reads as: the one that matches where the thread is now, so a run
 * that failed and then finished reads Done, never Failed. Else a stop, the finish, the start.
 */
export function currentEvent(
	events: AttentionEvent[],
	now: ThreadStatus | null,
): AttentionEvent | undefined {
	return (
		events.find((e) => kindStatus(e.kind, now) === now) ??
		events.find(
			(e) =>
				e.kind === "needs_you" ||
				e.kind === "failed" ||
				e.kind === "blocked" ||
				e.kind === "limited",
		) ??
		events.find((e) => e.kind === "finished") ??
		events.find((e) => e.kind === "started") ??
		events[0]
	);
}

/** Threads with an unread event: the one count the tab, the sidebar and the list agree on. */
export function unreadThreadCount(events: AttentionEvent[]): number {
	return new Set(events.filter((e) => !e.readAt).map((e) => e.threadId)).size;
}

/**
 * One thread as a list card: its status, the outcome in words (never title-only),
 * an incident's handover, and the one thing waiting on you, answerable here.
 */
export function AwayCard({
	thread,
	events,
	ask,
	now,
	testId = "away-card",
}: {
	thread: AttentionThread;
	events: AttentionEvent[];
	ask: RowAskEntry[];
	now: number;
	testId?: string;
}) {
	const navigate = useNavigate();
	const entry = ask[0];
	const state = useRowAsk(entry);
	const lead = currentEvent(events, thread.status);
	const words = lead ? eventWords(lead) : null;
	const status = lead
		? kindStatus(lead.kind, thread.status)
		: (thread.status ?? "done");
	const handover = thread.incident && (thread.cause || thread.nextCommand);
	const open = () =>
		void navigate({ to: "/threads/$id", params: { id: thread.id } });
	return (
		<ListCard
			title={threadName(thread)}
			status={status}
			statusWord={words?.word}
			meta={
				thread.incident ? (
					<span className="inline-flex items-center gap-1.5">
						#{thread.incident.number}
						<Mark
							id="severity"
							state={thread.incident.severity}
							word={severityWord(thread.incident.severity)}
							testId="away-severity"
						/>
					</span>
				) : undefined
			}
			detail={handover ? (thread.cause ?? words?.detail) : words?.detail}
			footer={
				(thread.nextCommand && handover) || entry ? (
					<div className="flex flex-col gap-1.5">
						{thread.nextCommand && handover && (
							<code className="block truncate font-mono text-mono">
								{thread.nextCommand}
							</code>
						)}
						{entry && (
							<div data-testid="away-ask">
								<RowAsk
									state={state}
									ended={entry.ended}
									accessLevel={entry.accessLevel}
									now={now}
									count={ask.length}
									openHref={open}
								/>
							</div>
						)}
					</div>
				) : undefined
			}
			link={(title) => (
				<Link to="/threads/$id" params={{ id: thread.id }}>
					{title}
				</Link>
			)}
			testId={testId}
		/>
	);
}
