/**
 * The Timeline route (#743 §3c, layer 2): the full record with its filters,
 * the note field at the top, on the same column and rail as every tab (L54).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useIncidentFacts } from "@/components/incidents/IncidentFacts";
import { NoteField } from "@/components/incidents/NoteField";
import { FactsRail, RecordPage } from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { TimelineTab } from "@/components/incidents/TimelineTab";

export const Route = createFileRoute("/_authenticated/incidents/$id/timeline")({
	component: TimelineRoute,
});

function TimelineRoute() {
	const { incident, runs, timeline, timelineLoading } = useIncidentRecord();
	const { rail } = useIncidentFacts();
	return (
		<RecordPage testId="timeline-route" rail={<FactsRail facts={rail} />}>
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
