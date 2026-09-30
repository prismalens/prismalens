// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	type AlertWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { StateWord } from "@/components/shared/StateChip";
import { formatClock } from "@/lib/format-time";
import { alertStatusTone } from "@/lib/state-tone";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";

/** One alert as a row: severity, name, status word, time. */
export function AlertRow({ alert }: { alert: AlertWithRelations }) {
	return (
		<li className="flex min-w-0 items-center gap-2 py-1.5 text-record">
			<span
				role="img"
				aria-label={SEVERITY_LABEL[alert.severity]}
				title={SEVERITY_LABEL[alert.severity]}
				className="h-2 w-2 shrink-0 rounded-full"
				style={{ background: `var(--sev-${alert.severity})` }}
			/>
			<Link
				to="/alerts/$id"
				params={{ id: alert.id }}
				className="min-w-0 flex-1 truncate hover:text-primary hover:underline"
				title={alert.title}
			>
				{alert.title}
			</Link>
			<StateWord tone={alertStatusTone(alert.status)} className="shrink-0">
				{ALERT_STATUS_LABEL[alert.status]}
			</StateWord>
			<span
				className="w-10 shrink-0 text-right text-meta text-muted-foreground tabular-nums"
				title={new Date(alert.triggeredAt).toLocaleString()}
			>
				{formatClock(alert.triggeredAt)}
			</span>
		</li>
	);
}

/** The first two correlated alerts; a storm lives on the Alerts route (#743 §3c.4). */
export function AlertsCard() {
	const { incident } = useIncidentRecord();
	const alerts = incident.alerts ?? [];
	return (
		<Card
			title="Alerts"
			count={incident.alertCount}
			aside={
				alerts.length > 2 && (
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
				<ul>
					{alerts.slice(0, 2).map((a) => (
						<AlertRow key={a.id} alert={a} />
					))}
				</ul>
			)}
		</Card>
	);
}
