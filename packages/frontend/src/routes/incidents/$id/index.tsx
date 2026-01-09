import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/incidents/$id/")({
	component: IncidentDetailPage,
});

function IncidentDetailPage() {
	const { id } = Route.useParams();

	return (
		<div>
			{/* TODO: Implement IncidentDetailPage */}
			{/* Will use: IncidentDetailHeader, IncidentOverview, CorrelatedAlerts,
          InvestigationProgress, RootCauseAnalysis, RecommendationsList,
          InvestigationCanvas */}
			<p>Incident ID: {id}</p>
		</div>
	);
}
