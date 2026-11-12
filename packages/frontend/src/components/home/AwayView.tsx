// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Home's away view (#1101 category 3): what changed while the operator was away,
 * by thread and grouped under each root, from the server's read state so every
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
import { ListCard, ListGrid } from "@/components/kit/ListCard";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import { Button } from "@/components/ui/button";
import { useThreadAsks } from "@/lib/api/hooks/use-threads-orpc";
import { eventWords, threadName } from "@/lib/attention/notify-rules";
import { useAwayView, useMarkEventsRead } from "@/lib/attention/use-attention";
import { formatDayClock } from "@/lib/format-time";

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

export function AwayView() {
	const away = useAwayView();
	const asks = useThreadAsks(!!away.data?.long);
	const markRead = useMarkEventsRead();
	if (!away.data || away.data.groups.length === 0) return null;
	return (
		<AwayList
			data={away.data}
			asks={asks.data?.asks ?? []}
			now={Date.now()}
			onMarkAll={() => markRead.mutate({})}
			marking={markRead.isPending}
		/>
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
				<Button
					variant="text"
					size="sm"
					className="ml-auto"
					onClick={onMarkAll}
					disabled={marking}
					data-testid="away-mark-all"
				>
					Mark all read
				</Button>
			</div>
			{data.groups.map((g) => (
				<div
					key={g.root.id}
					className="flex flex-col gap-1.5"
					data-testid="away-group"
				>
					{g.threads.length > 1 || g.threads[0]?.thread.id !== g.root.id ? (
						<p className="truncate text-meta text-text-3">
							Under {threadName(g.root)}
						</p>
					) : null}
					<ListGrid label={threadName(g.root)}>
						{g.threads.map(({ thread, events }) => (
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
				</div>
			))}
		</section>
	);
}

/** The event a card leads with: a stop, else the finish, else the start. */
function leadEvent(events: AttentionEvent[]): AttentionEvent | undefined {
	return (
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
	const lead = leadEvent(events);
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
				thread.incident
					? `#${thread.incident.number} · ${thread.incident.severity}`
					: undefined
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
