/**
 * The Timeline route (#743 §3c, layer 2): the full record with its filters,
 * the note field pinned at the top.
 */
import { createFileRoute } from "@tanstack/react-router";
import { NoteField } from "@/components/incidents/cards/NoteField";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { TimelineTab } from "@/components/incidents/TimelineTab";

export const Route = createFileRoute("/_authenticated/incidents/$id/timeline")({
	component: TimelineRoute,
});

function TimelineRoute() {
	const { incident, timeline, timelineLoading } = useIncidentRecord();
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="timeline-route">
			<div className="mx-auto w-full max-w-[52rem] px-4 pt-4 sm:px-6">
				<NoteField />
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[52rem] px-4 py-4 sm:px-6">
					<TimelineTab
						incidentId={incident.id}
						entries={timeline}
						isLoading={timelineLoading}
					/>
				</div>
			</div>
		</div>
	);
}
