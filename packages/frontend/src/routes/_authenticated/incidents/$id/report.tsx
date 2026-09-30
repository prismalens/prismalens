/**
 * The Report route (#743 §3c, layer 2): the run's report as a document, full
 * width under the pinned band and strip, with the evidence, similar past
 * incidents and the recommendations the run made.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RecommendationsList } from "@/components/incidents";
import { CardLink } from "@/components/incidents/cards/Card";
import { runElapsed, useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import {
	EvidenceSection,
	ReportSection,
	SimilarIncidentRow,
} from "@/components/investigation/ReportSections";
import { RecordSection } from "@/components/shared/RecordSection";
import { recommendationKeys } from "@/lib/api/hooks/use-recommendations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatElapsed } from "@/lib/format-time";

export const Route = createFileRoute("/_authenticated/incidents/$id/report")({
	component: ReportRoute,
});

function ReportRoute() {
	const { incident, run, runs, investigationId } = useIncidentRecord();
	const queryClient = useQueryClient();
	const investigation = run.investigation;
	const who = useRunAgentModel(investigation);
	const { data: recommendations = [] } = useQuery(
		orpc.recommendations.list.queryOptions({
			input: { incidentId: incident.id },
		}),
	);
	const recommendation = useMutation({
		...orpc.recommendations.update.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: recommendationKeys.all() }),
	});
	const done = run.state === "done" && !!investigation;
	const similar = investigation?.overlay?.similarIncidents ?? [];
	const number = runs.length - runs.findIndex((r) => r.id === investigationId);

	return (
		<div className="h-full overflow-y-auto" data-testid="report-route">
			<div className="mx-auto max-w-[52rem] space-y-6 px-4 py-4 sm:px-6">
				{!done || !investigation ? (
					<p
						className="rounded-md border border-dashed p-3 text-record text-muted-foreground"
						data-testid="report-empty"
					>
						{!investigationId
							? "No run yet. The report lands here when a run finishes."
							: run.state === "stopped" || run.state === "failed"
								? "None. The run did not finish."
								: "The report lands here when the run finishes."}
					</p>
				) : (
					<>
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
							<span className="tabular-nums">Run {number}</span>
							<span>
								{who.agent} {who.model}
							</span>
							<span className="tabular-nums">
								{formatElapsed(runElapsed(investigation, null))}
							</span>
							<span className="ml-auto">
								<CardLink incidentId={incident.id} to="conversation">
									Conversation
								</CardLink>
							</span>
						</div>
						<ReportSection investigation={investigation} />
						<EvidenceSection investigation={investigation} />
						{similar.length > 0 && (
							<RecordSection
								id="similar"
								title="Similar past incidents"
								count={similar.length}
							>
								<ul className="divide-y">
									{similar.map((s) => (
										<SimilarIncidentRow key={s.incidentId} similar={s} />
									))}
								</ul>
							</RecordSection>
						)}
					</>
				)}
				{recommendations.length > 0 && (
					<RecordSection
						id="recommendations"
						title="Recommendations"
						count={recommendations.length}
					>
						<RecommendationsList
							recommendations={recommendations}
							onComplete={(recId) =>
								recommendation.mutate({ id: recId, status: "completed" })
							}
							onDismiss={(recId) =>
								recommendation.mutate({ id: recId, status: "rejected" })
							}
						/>
					</RecordSection>
				)}
			</div>
		</div>
	);
}
