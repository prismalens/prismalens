// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	type AlertWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { ago, useNow } from "@/hooks/use-now";
import { type AlertGroup, alertDetail, alertGroups } from "@/lib/alert-groups";
import { formatClock } from "@/lib/format-time";
import { alertStatusTone } from "@/lib/state-tone";

export interface CorrelatedAlertsProps {
	alerts: AlertWithRelations[];
}

/** A group's line: worst severity, rule name, how many and how many still firing, its window. */
export function AlertGroupHead({ group }: { group: AlertGroup }) {
	const now = useNow();
	return (
		<div className="flex min-w-0 items-center gap-2 text-record">
			<span
				role="img"
				aria-label={SEVERITY_LABEL[group.severity]}
				title={SEVERITY_LABEL[group.severity]}
				className="h-2 w-2 shrink-0 rounded-full"
				style={{ background: `var(--sev-${group.severity})` }}
			/>
			<span className="min-w-0 truncate font-medium">{group.name}</span>
			<span className="shrink-0 text-meta text-muted-foreground tabular-nums">
				{group.alerts.length > 1 ? `×${group.alerts.length}` : ""}
			</span>
			<StateWord
				tone={group.firing > 0 ? "critical" : "done"}
				className="shrink-0"
			>
				{group.firing > 0
					? group.firing === group.alerts.length
						? "Firing"
						: `${group.firing} firing`
					: "Quiet"}
			</StateWord>
			<Mono
				className="ml-auto shrink-0 text-muted-foreground"
				title={`First ${new Date(group.firstAt).toLocaleString()}, last ${new Date(group.lastAt).toLocaleString()}`}
			>
				{formatClock(group.firstAt)}
				{group.lastAt !== group.firstAt ? `–${formatClock(group.lastAt)}` : ""}
				<span className="ml-2.5">{ago(group.lastAt, now)}</span>
			</Mono>
		</div>
	);
}

/** Every correlated alert, grouped by the rule that raised it (#743). */
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
			{alertGroups(alerts).map((group) => (
				<li
					key={group.name}
					className="space-y-1 px-3 py-2"
					data-testid="alert-group"
				>
					<AlertGroupHead group={group} />
					<ul className="space-y-0.5 pl-4">
						{group.alerts.map((alert) => (
							<li
								key={alert.id}
								className="flex min-w-0 items-center gap-2 text-meta"
							>
								<Link
									to="/alerts/$id"
									params={{ id: alert.id }}
									className="min-w-0 flex-1 truncate text-muted-foreground hover:text-primary hover:underline"
									title={alert.title}
								>
									{alertDetail(alert, group.name)}
								</Link>
								{alert.status !== "triggered" && (
									<StateWord
										tone={alertStatusTone(alert.status)}
										className="shrink-0"
									>
										{ALERT_STATUS_LABEL[alert.status]}
									</StateWord>
								)}
								{alert.source && (
									<Mono className="shrink-0 text-muted-foreground">
										{alert.source}
									</Mono>
								)}
							</li>
						))}
					</ul>
				</li>
			))}
		</ul>
	);
}
