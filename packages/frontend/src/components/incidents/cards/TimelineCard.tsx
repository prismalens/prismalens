// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { groupTimeline } from "@/lib/timeline-groups";
import { useIncidentRecord } from "../record-context";
import { TimelineList } from "../TimelineList";
import { Card, CardLink } from "./Card";
import { NoteField } from "./NoteField";

/** The note field and the last few entries; the rest is one route down (#743 §3c.5). */
export function TimelineCard({ rows = 3 }: { rows?: number }) {
	const { incident, runs, timeline, timelineLoading } = useIncidentRecord();
	const shown = groupTimeline(timeline, runs).slice(0, rows);
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
				<TimelineList items={shown} />
			)}
		</Card>
	);
}
