/**
 * The Report tab (#743): the selected investigation's report as a document,
 * with the evidence, similar past incidents and its recommendations. With no
 * report it points at the newest investigation that wrote one.
 */
import { runState } from "@prismalens/contracts";
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
import { useToast } from "@/hooks/use-toast";
import { recommendationKeys } from "@/lib/api/hooks/use-recommendations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatElapsed } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";

export const Route = createFileRoute("/_authenticated/incidents/$id/report")({
	component: ReportRoute,
});

function ReportRoute() {
	const { incident, run, runs, investigationId, selectRun } =
		useIncidentRecord();
	const queryClient = useQueryClient();
	const { toast } = useToast();
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
		onError: (err) =>
			toast({
				title: "Recommendation not updated",
				description: getErrorMessage(err),
				variant: "destructive",
			}),
	});
	const done = run.state === "done" && !!investigation;
	const similar = investigation?.overlay?.similarIncidents ?? [];
	const number = runs.length - runs.findIndex((r) => r.id === investigationId);
	// The newest investigation that did write a report, when this one did not.
	const lastGood = done
		? null
		: runs.findIndex((r) => runState(r.status, { hasEvents: true }) === "done");
	const lastGoodRun =
		lastGood !== null && lastGood >= 0 ? runs[lastGood] : null;

	return (
		<div className="h-full overflow-y-auto" data-testid="report-route">
			<div className="mx-auto max-w-[52rem] space-y-6 px-4 py-4 sm:px-6">
				{!done || !investigation ? (
					<p
						className="rounded-md border border-dashed p-3 text-body text-text-2"
						data-testid="report-empty"
					>
						{!investigationId
							? "No investigation yet. The report lands here when one finishes."
							: run.state === "stopped" || run.state === "failed"
								? `Investigation #${number} did not finish, so it wrote no report.`
								: "The report lands here when the investigation finishes."}
						{lastGoodRun && (
							<>
								{" "}
								<button
									type="button"
									onClick={() => selectRun(lastGoodRun.id)}
									className="text-accent hover:underline"
									data-testid="report-last-good"
								>
									Read the report from investigation #
									{runs.length - (lastGood ?? 0)}
								</button>
							</>
						)}
					</p>
				) : (
					<>
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-text-2">
							<span className="tabular-nums">Investigation #{number}</span>
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
