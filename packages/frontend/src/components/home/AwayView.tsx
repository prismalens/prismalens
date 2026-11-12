// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Home's away view (#1101 category 3): what changed while the operator was away,
 * by thread and grouped under each root, from the server's read state so every
 * device shows the same list. After a long gap each thread gets a card.
 */
import type {
	AttentionEvent,
	AttentionKind,
	AttentionThread,
	AwayView as AwayData,
	ThreadStatus,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { RowAsk, type RowAskEntry, useRowAsk } from "@/components/shell/RowAsk";
import { StatusMark } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { useThreadAsks } from "@/lib/api/hooks/use-threads-orpc";
import { eventWords } from "@/lib/attention/notify-rules";
import { useAwayView, useMarkEventsRead } from "@/lib/attention/use-attention";
import { formatDayClock } from "@/lib/format-time";
import { STATUS_TONE, TONE_TEXT } from "@/lib/thread-status";
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

function threadName(t: AttentionThread): string {
	return t.title?.trim() || "Untitled thread";
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
			<div className="flex items-baseline gap-3">
				<h2 className="text-body font-medium text-text-1">
					{data.since
						? `Since ${formatDayClock(data.since, now)}`
						: "What changed"}
				</h2>
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={onMarkAll}
					disabled={marking}
					data-testid="away-mark-all"
				>
					Mark all read
				</Button>
			</div>
			<ul className="flex flex-col gap-3">
				{data.groups.map((g) => (
					<li key={g.root.id} data-testid="away-group">
						{g.threads.length > 1 || g.threads[0]?.thread.id !== g.root.id ? (
							<p className="mb-1 truncate text-meta text-text-3">
								Under {threadName(g.root)}
							</p>
						) : null}
						<ul className="flex flex-col gap-2">
							{g.threads.map(({ thread, events }) => (
								<li key={thread.id}>
									{data.long ? (
										<AwayCard
											thread={thread}
											events={events}
											ask={asks.filter((a) => a.ask.threadId === thread.id)}
											now={now}
										/>
									) : events[0] ? (
										<AwayLine thread={thread} event={events[0]} />
									) : null}
								</li>
							))}
						</ul>
					</li>
				))}
			</ul>
		</section>
	);
}

/** A short gap: one line per thread, its newest change with its answer, cause or ask. */
function AwayLine({
	thread,
	event,
}: {
	thread: AttentionThread;
	event: AttentionEvent;
}) {
	const status = kindStatus(event.kind, thread.status);
	const { word, detail } = eventWords(event);
	return (
		<Link
			to="/threads/$id"
			params={{ id: thread.id }}
			className="group flex min-h-9 items-start gap-2 rounded-control px-2 py-1.5 hover:bg-surface-2"
			data-testid="away-line"
			data-kind={event.kind}
		>
			<StatusMark status={status} className="mt-0.5 shrink-0" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex items-baseline gap-2">
					<span className="truncate text-body text-text-1">
						{threadName(thread)}
					</span>
					<span
						className={cn(
							"shrink-0 text-meta font-medium",
							TONE_TEXT[STATUS_TONE[status]],
						)}
					>
						{word}
					</span>
				</span>
				{detail && (
					<span className="line-clamp-2 text-meta text-text-2">{detail}</span>
				)}
			</span>
		</Link>
	);
}

/**
 * A long gap: a card per thread saying what finished, what is blocked and the one
 * thing waiting on you, answerable here. An incident's card is its handover note.
 */
export function AwayCard({
	thread,
	events,
	ask,
	now,
}: {
	thread: AttentionThread;
	events: AttentionEvent[];
	ask: RowAskEntry[];
	now: number;
}) {
	const navigate = useNavigate();
	const entry = ask[0];
	const state = useRowAsk(entry);
	const finished = events.find((e) => e.kind === "finished");
	const stopped = events.find(
		(e) => e.kind === "failed" || e.kind === "blocked" || e.kind === "limited",
	);
	// A card always says what happened in words; a run that only started says so.
	const started =
		!finished && !stopped
			? events.find((e) => e.kind === "started")
			: undefined;
	const status =
		thread.status ?? kindStatus(events[0]?.kind ?? "finished", null);
	const open = () =>
		void navigate({ to: "/threads/$id", params: { id: thread.id } });
	return (
		<article
			className="flex flex-col gap-2 rounded-surface bg-surface-2 px-3 py-2.5"
			data-testid="away-card"
		>
			<header className="flex items-baseline gap-2">
				<StatusMark status={status} className="shrink-0 self-center" />
				<Link
					to="/threads/$id"
					params={{ id: thread.id }}
					className="min-w-0 flex-1 truncate text-body font-medium text-text-1 hover:underline"
				>
					{threadName(thread)}
				</Link>
				{thread.incident && (
					<span className="shrink-0 text-meta text-text-3">
						#{thread.incident.number} · {thread.incident.severity}
					</span>
				)}
			</header>
			{thread.incident && (thread.cause || thread.nextCommand) ? (
				<dl
					className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta"
					data-testid="away-handover"
				>
					{thread.cause && (
						<>
							<dt className="text-text-3">Likely cause</dt>
							<dd className="text-text-1">{thread.cause}</dd>
						</>
					)}
					{thread.nextCommand && (
						<>
							<dt className="text-text-3">Next</dt>
							<dd>
								<code className="font-mono text-text-1 break-all">
									{thread.nextCommand}
								</code>
							</dd>
						</>
					)}
				</dl>
			) : finished ? (
				<p
					className="line-clamp-3 text-meta text-text-2"
					data-testid="away-finished"
				>
					<span className="font-medium text-ok">Finished: </span>
					{eventWords(finished).detail}
				</p>
			) : started ? (
				<p
					className="line-clamp-3 text-meta text-text-2"
					data-testid="away-started"
				>
					<span className="font-medium text-live">
						{eventWords(started).word}:{" "}
					</span>
					{eventWords(started).detail}
				</p>
			) : null}
			{stopped && (
				<p className="text-meta text-text-2" data-testid="away-stopped">
					<span
						className={cn(
							"font-medium",
							TONE_TEXT[STATUS_TONE[kindStatus(stopped.kind, null)]],
						)}
					>
						{eventWords(stopped).word}:{" "}
					</span>
					{eventWords(stopped).detail}
				</p>
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
		</article>
	);
}
