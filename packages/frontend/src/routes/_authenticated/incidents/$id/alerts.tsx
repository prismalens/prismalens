/**
 * The Alerts route (#743 §3c, layer 2): every correlated alert, storms
 * included, on the same column and rail as every tab. The Overview shows
 * the first three.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CorrelatedAlerts } from "@/components/incidents/CorrelatedAlerts";
import { useIncidentFacts } from "@/components/incidents/IncidentFacts";
import { FactsRail, RecordPage } from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";

export const Route = createFileRoute("/_authenticated/incidents/$id/alerts")({
	component: AlertsRoute,
});

function AlertsRoute() {
	const { incident } = useIncidentRecord();
	const { rail } = useIncidentFacts();
	return (
		<RecordPage testId="alerts-route" rail={<FactsRail facts={rail} />}>
			<h2 className="mb-2 flex items-baseline gap-2 text-heading">
				Alerts
				<span className="font-normal text-text-3 tabular-nums">
					{incident.alertCount}
				</span>
			</h2>
			<CorrelatedAlerts alerts={incident.alerts ?? []} />
		</RecordPage>
	);
}
