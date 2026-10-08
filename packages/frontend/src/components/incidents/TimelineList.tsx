// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	RUN_STATE_LABEL,
	runState,
	type TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { StateWord } from "@/components/shared/StateWord";
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
		<Hint label={ago(at, now)} side="left">
			<span className="font-mono text-mono text-text-3 tabular-nums">
				{formatClock(at)}
			</span>
		</Hint>
	);
}

const ROW =
	"grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-body";

function EntryRow({
	entry,
	full,
}: {
	entry: TimelineEntryWithRelations;
	full: boolean;
}) {
	const note = entry.type === "comment";
	const by = who(entry);
	// An entry with a reason says it in the summary view too (#673 w23).
	const reasoned = typeof entry.metadata?.reason === "string";
	const linked = entry.metadata?.mergedIntoId ?? entry.metadata?.mergedFromId;
	return (
		<li className={ROW} data-testid="timeline-row">
			<Clock at={entry.occurredAt} />
			<span className="min-w-0">
				<span
					className={cn(
						"block",
						note && full ? "whitespace-pre-wrap break-words" : "truncate",
					)}
				>
					{typeof linked === "string" ? (
						<Link
							to="/incidents/$id"
							params={{ id: linked }}
							className="hover:text-accent"
							data-testid="timeline-merge-link"
						>
							{entry.title}
						</Link>
					) : (
						entry.title
					)}
				</span>
				{(full || reasoned) && entry.description && !note && (
					<span className="block truncate text-meta text-text-3">
						{entry.description}
					</span>
				)}
			</span>
			<span className="text-meta text-text-3">{by}</span>
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
				className={cn(
					ROW,
					"-mx-2 w-[calc(100%+1rem)] rounded-control px-2 text-left transition-colors duration-(--dur-instant) enabled:hover:bg-surface-3",
				)}
			>
				<Clock at={item.at} />
				<span className="flex min-w-0 items-baseline gap-2">
					{full && (
						<ChevronRight
							className={cn(
								"size-3.5 shrink-0 self-center text-text-3 transition-transform duration-(--dur-fast)",
								open && "rotate-90",
							)}
						/>
					)}
					<span className="shrink-0">
						Run{item.number ? ` #${item.number}` : ""}
					</span>
					{reason && <span className="truncate text-text-2">{reason}</span>}
					{item.noRepo && (
						<span className="shrink-0 truncate text-meta text-text-3">
							No repository
						</span>
					)}
				</span>
				{full && state ? (
					<StateWord tone={runStateTone(state)} className="shrink-0">
						{RUN_STATE_LABEL[state]}
					</StateWord>
				) : (
					<span />
				)}
			</button>
			{full && open && (
				<ul className="ml-14 divide-y divide-hairline">
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
		<ul className="divide-y divide-hairline" data-testid="timeline-list">
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
