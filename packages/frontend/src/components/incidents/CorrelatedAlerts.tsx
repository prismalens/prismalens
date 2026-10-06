// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	type AlertWithRelations,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { Empty } from "@/components/shared/State";
import { StateWord } from "@/components/shared/StateWord";
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
		<div className="flex min-w-0 items-center gap-2 text-body">
			<span
				role="img"
				aria-label={SEVERITY_LABEL[group.severity]}
				className="size-2 shrink-0 rounded-full"
				style={{ background: `var(--sev-${group.severity})` }}
			/>
			<span className="min-w-0 truncate font-medium">{group.name}</span>
			{group.alerts.length > 1 && (
				<span className="shrink-0 text-meta text-text-3 tabular-nums">
					{group.alerts.length} times
				</span>
			)}
			<StateWord tone={group.firing > 0 ? "danger" : "ok"} className="shrink-0">
				{group.firing > 0
					? group.firing === group.alerts.length
						? "Firing"
						: `${group.firing} firing`
					: "Cleared"}
			</StateWord>
			<Hint
				label={`First ${new Date(group.firstAt).toLocaleString()}, last ${new Date(group.lastAt).toLocaleString()}`}
			>
				<Mono className="ml-auto shrink-0 text-text-3">
					{formatClock(group.firstAt)}
					{group.lastAt !== group.firstAt
						? ` to ${formatClock(group.lastAt)}`
						: ""}
					<span className="ml-2.5 font-sans">{ago(group.lastAt, now)}</span>
				</Mono>
			</Hint>
		</div>
	);
}

/** Every correlated alert, grouped by the rule that raised it (#743); rows, never a card. */
export function CorrelatedAlerts({ alerts }: CorrelatedAlertsProps) {
	if (alerts.length === 0) {
		return <Empty text="No alerts are correlated to this incident yet." />;
	}
	return (
		<ul className="divide-y divide-hairline">
			{alertGroups(alerts).map((group) => (
				<li key={group.name} className="py-2.5" data-testid="alert-group">
					<AlertGroupHead group={group} />
					<ul className="mt-1 pl-4">
						{group.alerts.map((alert) => (
							<li
								key={alert.id}
								className="flex min-h-6 min-w-0 items-center gap-2 text-meta"
							>
								<Link
									to="/alerts/$id"
									params={{ id: alert.id }}
									className="min-w-0 flex-1 truncate text-text-2 hover:text-text-1"
								>
									{alertDetail(alert, group.name)}
								</Link>
								<StateWord
									tone={alertStatusTone(alert.status)}
									className="shrink-0"
								>
									{alert.status === "triggered"
										? "Firing"
										: ALERT_STATUS_LABEL[alert.status]}
								</StateWord>
								{alert.source && (
									<Mono className="shrink-0 text-text-3">{alert.source}</Mono>
								)}
							</li>
						))}
					</ul>
				</li>
			))}
		</ul>
	);
}
