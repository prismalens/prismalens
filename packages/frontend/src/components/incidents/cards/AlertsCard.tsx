// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { alertGroups } from "@/lib/alert-groups";
import { AlertGroupHead } from "../CorrelatedAlerts";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";

/** The first alert groups by rule; every alert lives on the Alerts tab (#743 §3c.4). */
export function AlertsCard() {
	const { incident } = useIncidentRecord();
	const alerts = incident.alerts ?? [];
	const groups = alertGroups(alerts);
	return (
		<Card
			title="Alerts"
			count={incident.alertCount}
			aside={
				alerts.length > 0 && (
					<CardLink
						incidentId={incident.id}
						to="alerts"
						testId="alerts-see-all"
					>
						See all
					</CardLink>
				)
			}
			testId="alerts-card"
		>
			{alerts.length === 0 ? (
				<p className="text-record text-muted-foreground">
					No alerts are correlated yet.
				</p>
			) : (
				<ul className="space-y-1.5">
					{groups.slice(0, 3).map((g) => (
						<li key={g.name}>
							<AlertGroupHead group={g} />
						</li>
					))}
				</ul>
			)}
		</Card>
	);
}
