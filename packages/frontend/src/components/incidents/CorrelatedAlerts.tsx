// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Correlated Alerts Component
 *
 * Shows alerts that are linked to the incident
 */

import type { AlertWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Mono } from "@/components/shared/Mono";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";

export interface CorrelatedAlertsProps {
	alerts: AlertWithRelations[];
}

export function CorrelatedAlerts({ alerts }: CorrelatedAlertsProps) {
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
				<li
					key={alert.id}
					className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2"
				>
					<div className="flex shrink-0 items-center gap-1.5 pt-0.5">
						<SeverityBadge severity={alert.severity} />
						<StatusBadge status={alert.status} kind="alert" />
					</div>
					<div className="min-w-0 flex-1">
						<Link
							to="/alerts/$id"
							params={{ id: alert.id }}
							className="block truncate text-record font-medium hover:text-primary hover:underline"
						>
							{alert.title}
						</Link>
						{alert.description && (
							<p className="line-clamp-2 text-record text-muted-foreground">
								{alert.description}
							</p>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-3 text-meta text-muted-foreground">
						{alert.service && (
							<Link
								to="/services/$id"
								params={{ id: alert.service.id }}
								search={{ tab: "overview" }}
								className="hover:text-primary"
							>
								{alert.service.displayName || alert.service.name}
							</Link>
						)}
						{alert.source && <span>{alert.source}</span>}
						<Mono title={new Date(alert.triggeredAt).toLocaleString()}>
							{formatDistanceToNow(new Date(alert.triggeredAt), {
								addSuffix: true,
							})}
						</Mono>
					</div>
				</li>
			))}
		</ul>
	);
}
