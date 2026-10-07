/**
 * The Timeline route (#743 §3c, layer 2): the full record with its filters,
 * the note field at the top, in the one column every tab uses (#673).
 */
import { createFileRoute } from "@tanstack/react-router";
import { NoteField } from "@/components/incidents/NoteField";
import { RecordPage } from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { TimelineTab } from "@/components/incidents/TimelineTab";

export const Route = createFileRoute("/_authenticated/incidents/$id/timeline")({
	component: TimelineRoute,
});

function TimelineRoute() {
	const { incident, runs, timeline, timelineLoading } = useIncidentRecord();
	return (
		<RecordPage testId="timeline-route">
			<NoteField className="mt-0 mb-4" />
			<TimelineTab
				incidentId={incident.id}
				entries={timeline}
				runs={runs}
				isLoading={timelineLoading}
			/>
		</RecordPage>
	);
}
