// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	TIMELINE_SOURCE_LABEL,
	type TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { formatClock } from "@/lib/format-time";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";
import { NoteField } from "./NoteField";

/** The newest entries first, the way the Timeline route orders them. */
export function newestFirst(entries: TimelineEntryWithRelations[]) {
	return [...entries].sort(
		(a, b) =>
			new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
	);
}

export function TimelineRows({
	entries,
}: {
	entries: TimelineEntryWithRelations[];
}) {
	return (
		<ul className="space-y-1">
			{entries.map((e) => (
				<li
					key={e.id}
					className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-2 text-record"
				>
					<span className="font-mono text-meta text-muted-foreground tabular-nums">
						{formatClock(e.occurredAt)}
					</span>
					<span className="truncate" title={e.title}>
						{e.title}
					</span>
					<span className="text-meta text-muted-foreground">
						{TIMELINE_SOURCE_LABEL[e.source] ?? e.source}
					</span>
				</li>
			))}
		</ul>
	);
}

/** The note field and the last few entries; the rest is one route down (#743 §3c.5). */
export function TimelineCard({ rows = 3 }: { rows?: number }) {
	const { incident, timeline, timelineLoading } = useIncidentRecord();
	const shown = newestFirst(timeline).slice(0, rows);
	return (
		<Card
			title="Timeline"
			count={timeline.length}
			aside={
				<CardLink
					incidentId={incident.id}
					to="timeline"
					testId="timeline-see-all"
				>
					See all
				</CardLink>
			}
			testId="timeline-card"
		>
			<NoteField />
			{timelineLoading ? (
				<p className="text-record text-muted-foreground">Loading…</p>
			) : shown.length === 0 ? (
				<p className="text-record text-muted-foreground">
					Nothing recorded yet.
				</p>
			) : (
				<TimelineRows entries={shown} />
			)}
		</Card>
	);
}
