// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Correlated Alerts Component
 *
 * Shows alerts that are linked to the incident
 */

import {
	ALERT_STATUS_LABEL,
	type AlertWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { alertStatusTone } from "@/lib/state-tone";

export interface CorrelatedAlertsProps {
	alerts: AlertWithRelations[];
}

export function CorrelatedAlerts({ alerts }: CorrelatedAlertsProps) {
	const now = useNow();
	if (alerts.length === 0) {
		return (
			<p className="rounded-md border border-dashed p-3 text-record text-muted-foreground">
				No alerts are correlated to this incident yet. Alerts that match land
				here on intake.
			</p>
		);
	}

	return (
		<ul className="divide-y rounded-md border">
			{alerts.map((alert) => (
				<li key={alert.id} className="px-3 py-2">
					<div className="flex items-center gap-2 text-meta text-muted-foreground">
						<span
							aria-label={SEVERITY_LABEL[alert.severity]}
							title={SEVERITY_LABEL[alert.severity]}
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ background: `var(--sev-${alert.severity})` }}
						/>
						<StateWord tone={alertStatusTone(alert.status)}>
							{ALERT_STATUS_LABEL[alert.status]}
						</StateWord>
						<Mono
							className="ml-auto shrink-0"
							title={new Date(alert.triggeredAt).toLocaleString()}
						>
							{ago(alert.triggeredAt, now)}
						</Mono>
					</div>
					<Link
						to="/alerts/$id"
						params={{ id: alert.id }}
						className="mt-0.5 block truncate text-record font-medium hover:text-primary hover:underline"
						title={alert.title}
					>
						{alert.title}
					</Link>
					{(alert.service || alert.source) && (
						<div className="mt-0.5 flex items-center gap-2 truncate text-meta text-muted-foreground">
							{alert.service && (
								<span className="truncate">
									{alert.service.displayName || alert.service.name}
								</span>
							)}
							{alert.source && <Mono className="shrink-0">{alert.source}</Mono>}
						</div>
					)}
				</li>
			))}
		</ul>
	);
}
