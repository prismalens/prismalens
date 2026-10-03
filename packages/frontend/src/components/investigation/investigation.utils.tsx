// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	WORKFLOW_STATUS_LABEL,
	type WorkflowStatus,
} from "@prismalens/contracts";
import { Activity, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { StateWord } from "@/components/shared/StateWord";
import { recommendationPriorityTone, runStatusTone } from "@/lib/state-tone";

const statusIcons: Record<string, typeof CheckCircle> = {
	completed: CheckCircle,
	running: Activity,
	failed: AlertCircle,
	pending: Clock,
};

export function InvestigationStatusBadge({ status }: { status: string }) {
	const Icon = statusIcons[status] ?? Clock;
	const label = WORKFLOW_STATUS_LABEL[status as WorkflowStatus] ?? status;

	return (
		<StateWord tone={runStatusTone(status)}>
			<Icon className="w-3 h-3 mr-1" />
			{label}
		</StateWord>
	);
}

export function PriorityBadge({ priority }: { priority: string }) {
	return (
		<StateWord tone={recommendationPriorityTone(priority)}>
			{priority}
		</StateWord>
	);
}
