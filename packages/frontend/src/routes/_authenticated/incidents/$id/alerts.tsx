/**
 * The Alerts route (#743 §3c, layer 2): every correlated alert, storms
 * included. The card on the incident page shows the first two.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CorrelatedAlerts } from "@/components/incidents/CorrelatedAlerts";
import { useIncidentRecord } from "@/components/incidents/record-context";

export const Route = createFileRoute("/_authenticated/incidents/$id/alerts")({
	component: AlertsRoute,
});

function AlertsRoute() {
	const { incident } = useIncidentRecord();
	return (
		<div className="h-full overflow-y-auto" data-testid="alerts-route">
			<div className="mx-auto max-w-[52rem] space-y-3 px-4 py-4 sm:px-6">
				<h2 className="flex items-baseline gap-2 text-sm font-medium">
					Alerts
					<span className="text-meta font-normal text-text-2 tabular-nums">
						{incident.alertCount}
					</span>
				</h2>
				<CorrelatedAlerts alerts={incident.alerts ?? []} />
			</div>
		</div>
	);
}
