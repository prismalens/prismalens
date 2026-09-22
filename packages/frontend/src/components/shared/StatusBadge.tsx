// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	type AlertStatus,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
} from "@prismalens/contracts";
import { alertStatusTone, incidentStatusTone } from "@/lib/state-tone";
import { StateChip } from "./StateChip";

export interface StatusBadgeProps {
	status: AlertStatus | IncidentStatus;
	/** Alerts and incidents share the words `triggered` and `resolved`; say which enum this is. */
	kind?: "alert" | "incident";
	className?: string;
}

function isAlertStatus(status: string): status is AlertStatus {
	return Object.hasOwn(ALERT_STATUS_LABEL, status);
}

export function StatusBadge({ status, kind, className }: StatusBadgeProps) {
	const asAlert =
		kind === "alert" ||
		(kind === undefined &&
			isAlertStatus(status) &&
			!Object.hasOwn(INCIDENT_STATUS_LABEL, status));
	const label = asAlert
		? (ALERT_STATUS_LABEL[status as AlertStatus] ?? status)
		: (INCIDENT_STATUS_LABEL[status as IncidentStatus] ?? status);
	const tone = asAlert ? alertStatusTone(status) : incidentStatusTone(status);
	return (
		<StateChip tone={tone} className={className}>
			{label}
		</StateChip>
	);
}
