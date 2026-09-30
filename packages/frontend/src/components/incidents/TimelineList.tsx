// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	RUN_STATE_LABEL,
	runState,
	type TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { failureWords } from "@/lib/failure-words";
import { formatClock } from "@/lib/format-time";
import { runStateTone } from "@/lib/state-tone";
import type { TimelineItem } from "@/lib/timeline-groups";
import { cn } from "@/lib/utils";

function who(entry: TimelineEntryWithRelations): string | null {
	if (entry.source !== "user") return null;
	const u = entry.user;
	if (!u) return "Operator";
	return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
}

function Clock({ at }: { at: string }) {
	const now = useNow();
	return (
		<span
			className="font-mono text-meta text-muted-foreground tabular-nums"
			title={ago(at, now)}
		>
			{formatClock(at)}
		</span>
	);
}

function EntryRow({
	entry,
	full,
}: {
	entry: TimelineEntryWithRelations;
	full: boolean;
}) {
	const note = entry.type === "comment";
	const by = who(entry);
	return (
		<li
			className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-2 py-0.5 text-record"
			data-testid="timeline-row"
		>
			<Clock at={entry.occurredAt} />
			<span className="min-w-0">
				<span
					className={cn(
						"block",
						note && full ? "whitespace-pre-wrap break-words" : "truncate",
					)}
					title={entry.title}
				>
					{entry.title}
				</span>
				{full && entry.description && !note && (
					<span className="block truncate text-meta text-muted-foreground">
						{entry.description}
					</span>
				)}
			</span>
			<span className="text-meta text-muted-foreground">{by}</span>
		</li>
	);
}

function InvestigationRow({
	item,
	full,
}: {
	item: Extract<TimelineItem, { kind: "investigation" }>;
	full: boolean;
}) {
	const [open, setOpen] = useState(false);
	const state = item.run
		? runState(item.run.status, { hasEvents: true })
		: null;
	const reason = state === "failed" ? failureWords(item.run?.error).what : null;
	return (
		<li data-testid="timeline-investigation">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				disabled={!full}
				className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-2 rounded py-0.5 text-left text-record enabled:hover:bg-muted/60"
			>
				<Clock at={item.at} />
				<span className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0">
						Investigation{item.number ? ` #${item.number}` : ""}
					</span>
					{state && (
						<StateWord tone={runStateTone(state)} className="shrink-0">
							{RUN_STATE_LABEL[state]}
						</StateWord>
					)}
					{reason && (
						<span className="truncate text-muted-foreground">{reason}</span>
					)}
					{item.noRepo && (
						<StateWord tone="stale" className="shrink-0">
							No repository
						</StateWord>
					)}
				</span>
				{full ? (
					<ChevronRight
						className={cn(
							"h-3.5 w-3.5 self-center text-muted-foreground",
							open && "rotate-90",
						)}
					/>
				) : (
					<span />
				)}
			</button>
			{full && open && (
				<ul className="ml-[3.25rem] border-l pl-3">
					{item.entries.map((e) => (
						<EntryRow key={e.id} entry={e} full />
					))}
				</ul>
			)}
		</li>
	);
}

/**
 * Timeline rows (#743): one line per entry, and one per investigation with
 * its own entries folded under it. `full` shows descriptions and whole notes
 * and lets an investigation open.
 */
export function TimelineList({
	items,
	full = false,
}: {
	items: TimelineItem[];
	full?: boolean;
}) {
	return (
		<ul className="space-y-0.5" data-testid="timeline-list">
			{items.map((item) =>
				item.kind === "entry" ? (
					<EntryRow key={item.entry.id} entry={item.entry} full={full} />
				) : (
					<InvestigationRow key={item.id} item={item} full={full} />
				),
			)}
		</ul>
	);
}
