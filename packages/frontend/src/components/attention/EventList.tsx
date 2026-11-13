// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The event list (#1101 categories 3 and 4): what happened to threads, Unread or
 * All, with Mark all read. It is a page, not a sheet (pattern sheet §1); a row
 * opens its thread at its first unseen event.
 */
import type { AttentionEvent } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { kindStatus } from "@/components/home/AwayView";
import { StartedByMark } from "@/components/kit/MarkBadges";
import { Status } from "@/components/kit/Status";
import { Tabs } from "@/components/kit/Tabs";
import { Empty, Loading } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { eventWords, threadName } from "@/lib/attention/notify-rules";
import {
	useAttentionEvents,
	useMarkEventsRead,
} from "@/lib/attention/use-attention";
import { ageWord } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

/** The unread count the sidebar's Events entry carries. */
export function useUnreadEvents(enabled = true): number {
	return useAttentionEvents("unread", 1, enabled).data?.unread ?? 0;
}

export function EventListPanel() {
	const [filter, setFilter] = useState<"unread" | "all">("unread");
	const events = useAttentionEvents(filter, 50);
	const markRead = useMarkEventsRead();
	const navigate = useNavigate();
	const open = (e: AttentionEvent) => {
		if (!e.readAt) markRead.mutate({ ids: [e.id] });
		void navigate({ to: "/threads/$id", params: { id: e.threadId } });
	};
	return (
		<EventListView
			filter={filter}
			onFilter={setFilter}
			events={events.data?.events}
			loading={events.isLoading}
			unread={events.data?.unread ?? 0}
			onMarkAll={() => markRead.mutate({})}
			onOpenEvent={open}
			now={Date.now()}
		/>
	);
}

/** The list from data, for the gallery and tests. */
export function EventListView({
	filter,
	onFilter,
	events,
	loading,
	unread,
	onMarkAll,
	onOpenEvent,
	now,
}: {
	filter: "unread" | "all";
	onFilter: (f: "unread" | "all") => void;
	events: AttentionEvent[] | undefined;
	loading: boolean;
	unread: number;
	onMarkAll: () => void;
	onOpenEvent: (e: AttentionEvent) => void;
	now: number;
}) {
	return (
		<div className="flex flex-col gap-2" data-testid="event-list">
			<div className="flex items-center gap-3">
				<Tabs
					label="Events"
					value={filter}
					onValueChange={(v) => onFilter(v as "unread" | "all")}
					items={[
						{
							value: "unread",
							label: "Unread",
							count: unread || undefined,
						},
						{ value: "all", label: "All" },
					]}
				/>
				<Button
					variant="text"
					size="sm"
					className="ml-auto"
					disabled={unread === 0}
					onClick={onMarkAll}
					data-testid="events-mark-all"
				>
					Mark all read
				</Button>
			</div>
			{loading ? (
				<Loading rows={3} />
			) : !events?.length ? (
				<Empty text={filter === "unread" ? "All caught up" : "No events yet"} />
			) : (
				<ul className="flex flex-col">
					{events.map((e) => (
						<li key={e.id}>
							<EventRow event={e} now={now} onOpen={() => onOpenEvent(e)} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** A flat row: the status icon, the thread, its age, then the word and one detail line. */
function EventRow({
	event,
	now,
	onOpen,
}: {
	event: AttentionEvent;
	now: number;
	onOpen: () => void;
}) {
	const status = kindStatus(event.kind, event.thread.status);
	const { word, detail } = eventWords(event);
	const unread = !event.readAt;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-start gap-2.5 rounded-control px-2 py-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
			data-testid="event-row"
			data-kind={event.kind}
			data-unread={unread ? "" : undefined}
		>
			<Status kind={status} word={word} showWord={false} className="mt-0.5" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex min-w-0 items-baseline gap-2">
					<span
						className={cn(
							"min-w-0 truncate text-body",
							unread ? "font-medium text-text-1" : "text-text-2",
						)}
					>
						{threadName(event.thread)}
					</span>
					<span className="ml-auto shrink-0 text-meta text-text-3">
						{ageWord(Date.parse(event.at), now)}
					</span>
				</span>
				<span className="truncate text-meta text-text-2">
					<span className="font-medium">{word}</span>
					{detail ? <span> · {detail}</span> : null}
				</span>
				{event.thread.startedBy && (
					<span className="flex min-w-0 items-center gap-1 text-meta text-text-3">
						<StartedByMark by={{ ...event.thread.startedBy, via: "agent" }} />
						<span className="truncate">{event.thread.startedBy.title}</span>
					</span>
				)}
			</span>
		</button>
	);
}
