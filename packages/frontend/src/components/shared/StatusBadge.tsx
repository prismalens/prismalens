// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertStatus, IncidentStatus } from "@prismalens/contracts";
import { type ChipTone, StateChip } from "./StateChip";

export interface StatusBadgeProps {
	status: AlertStatus | IncidentStatus;
	className?: string;
}

const statusTone: Record<string, { label: string; tone: ChipTone }> = {
	// Alert statuses
	triggered: { label: "Triggered", tone: "critical" },
	acknowledged: { label: "Acknowledged", tone: "low" },
	correlated: { label: "Correlated", tone: "primary" },
	resolved: { label: "Resolved", tone: "done" },
	suppressed: { label: "Suppressed", tone: "neutral" },
	// Incident statuses
	investigating: { label: "Investigating", tone: "active" },
	identified: { label: "Identified", tone: "high" },
	monitoring: { label: "Monitoring", tone: "low" },
	closed: { label: "Closed", tone: "neutral" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
	const config = statusTone[status] || {
		label: status,
		tone: "neutral" as const,
	};
	return (
		<StateChip tone={config.tone} className={className}>
			{config.label}
		</StateChip>
	);
}
