// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SEVERITY_LABEL, type Severity } from "@prismalens/contracts";
import { severityTone } from "@/lib/state-tone";
import { StateChip } from "./StateChip";

export interface SeverityBadgeProps {
	severity: Severity;
	className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
	return (
		<StateChip tone={severityTone(severity)} className={className}>
			{SEVERITY_LABEL[severity] ?? severity}
		</StateChip>
	);
}
