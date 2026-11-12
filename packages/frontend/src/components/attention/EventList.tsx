// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The event list (#1101 categories 3 and 4): what happened to threads, Unread or
 * All, with Mark all read. A row opens its thread at its first unseen event.
 */
import type { AttentionEvent } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";
import { kindStatus } from "@/components/home/AwayView";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading } from "@/components/shared/State";
import { StatusMark } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { eventWords } from "@/lib/attention/notify-rules";
import {
	useAttentionEvents,
	useMarkEventsRead,
} from "@/lib/attention/use-attention";
import { ageWord, STATUS_TONE, TONE_TEXT } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

export function EventListButton({ className }: { className?: string }) {
	const [open, setOpen] = useState(false);
	const unread = useAttentionEvents("unread", 1).data?.unread ?? 0;
	const label = unread > 0 ? `Events, ${unread} unread` : "Events";
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Hint label={label} side="right">
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={label}
						className={cn(
							"relative flex size-8 items-center justify-center rounded-control text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1",
							className,
						)}
						data-testid="events-button"
					>
						<Bell className="size-4" aria-hidden />
						{unread > 0 && (
							<span
								className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-medium text-accent-fg tabular-nums"
								data-testid="events-unread"
							>
								{unread > 99 ? "99+" : unread}
							</span>
						)}
					</button>
				</PopoverTrigger>
			</Hint>
			<PopoverContent
				align="start"
				side="right"
				className="w-[360px] max-w-[calc(100vw-32px)]"
			>
				{open && <EventListPanel onOpen={() => setOpen(false)} />}
			</PopoverContent>
		</Popover>
	);
}

export function EventListPanel({ onOpen }: { onOpen?: () => void }) {
	const [filter, setFilter] = useState<"unread" | "all">("unread");
	const events = useAttentionEvents(filter, 50);
	const markRead = useMarkEventsRead();
	const navigate = useNavigate();
	const open = (e: AttentionEvent) => {
		if (!e.readAt) markRead.mutate({ ids: [e.id] });
		onOpen?.();
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
		<div className="flex max-h-[70vh] flex-col" data-testid="event-list">
			<div className="flex items-center gap-1 px-2 pt-2 pb-1.5">
				<div role="tablist" aria-label="Events" className="flex gap-0.5">
					{(["unread", "all"] as const).map((f) => (
						<button
							key={f}
							type="button"
							role="tab"
							aria-selected={filter === f}
							onClick={() => onFilter(f)}
							className={cn(
								"h-7 rounded-control px-2.5 text-meta",
								filter === f
									? "bg-surface-3 font-medium text-text-1"
									: "text-text-2 hover:bg-surface-2",
							)}
							data-testid={`events-${f}`}
						>
							{f === "unread" ? `Unread${unread ? ` ${unread}` : ""}` : "All"}
						</button>
					))}
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto"
					disabled={unread === 0}
					onClick={onMarkAll}
					data-testid="events-mark-all"
				>
					Mark all read
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pb-1.5">
				{loading ? (
					<div className="px-3">
						<Loading rows={3} />
					</div>
				) : !events?.length ? (
					<div className="px-3">
						<Empty
							text={filter === "unread" ? "All caught up" : "No events yet"}
						/>
					</div>
				) : (
					<ul>
						{events.map((e) => (
							<li key={e.id}>
								<EventRow event={e} now={now} onOpen={() => onOpenEvent(e)} />
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

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
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
			data-testid="event-row"
			data-kind={event.kind}
			data-unread={event.readAt ? undefined : ""}
		>
			<StatusMark status={status} className="mt-0.5 shrink-0" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex items-baseline gap-2">
					<span
						className={cn(
							"truncate text-body",
							event.readAt ? "text-text-2" : "font-medium text-text-1",
						)}
					>
						{event.thread.title?.trim() || "Untitled thread"}
					</span>
					<span className="ml-auto shrink-0 text-meta text-text-3">
						{ageWord(Date.parse(event.at), now)}
					</span>
				</span>
				<span className="truncate text-meta">
					<span className={cn("font-medium", TONE_TEXT[STATUS_TONE[status]])}>
						{word}
					</span>
					{detail ? <span className="text-text-2"> · {detail}</span> : null}
				</span>
				{event.thread.rootTitle && (
					<span className="truncate text-meta text-text-3">
						Under {event.thread.rootTitle}
					</span>
				)}
			</span>
		</button>
	);
}
