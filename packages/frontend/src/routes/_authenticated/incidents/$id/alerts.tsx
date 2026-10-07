/**
 * The Alerts route (#743 §3c, layer 2): every correlated alert, storms
 * included, in the one column every tab uses. The Overview shows
 * the first three.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CorrelatedAlerts } from "@/components/incidents/CorrelatedAlerts";
import { RecordPage } from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";

export const Route = createFileRoute("/_authenticated/incidents/$id/alerts")({
	component: AlertsRoute,
});

function AlertsRoute() {
	const { incident } = useIncidentRecord();
	return (
		<RecordPage testId="alerts-route">
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
