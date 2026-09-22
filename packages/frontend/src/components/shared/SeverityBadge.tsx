// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity } from "@prismalens/contracts";
import { type ChipTone, StateChip } from "./StateChip";

export interface SeverityBadgeProps {
	severity: Severity;
	className?: string;
}

const severityTone: Record<Severity, { label: string; tone: ChipTone }> = {
	critical: { label: "Critical", tone: "critical" },
	high: { label: "High", tone: "high" },
	medium: { label: "Medium", tone: "medium" },
	low: { label: "Low", tone: "low" },
	info: { label: "Info", tone: "info" },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
	const config = severityTone[severity] || severityTone.info;
	return (
		<StateChip tone={config.tone} className={className}>
			{config.label}
		</StateChip>
	);
}
