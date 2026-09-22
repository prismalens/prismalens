// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Activity, AlertCircle, CheckCircle, Clock } from "lucide-react";

import { type ChipTone, StateChip } from "@/components/shared/StateChip";

const statusConfig: Record<
	string,
	{ icon: typeof CheckCircle; tone: ChipTone }
> = {
	completed: {
		icon: CheckCircle,
		tone: "done",
	},
	running: {
		icon: Activity,
		tone: "active",
	},
	failed: {
		icon: AlertCircle,
		tone: "failed",
	},
	pending: {
		icon: Clock,
		tone: "neutral",
	},
};

export function InvestigationStatusBadge({ status }: { status: string }) {
	const config =
		statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<StateChip tone={config.tone}>
			<Icon className="w-3 h-3 mr-1" />
			{status}
		</StateChip>
	);
}

const priorityTone: Record<string, ChipTone> = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
};

export function PriorityBadge({ priority }: { priority: string }) {
	const tone = priorityTone[priority.toLowerCase()] || "medium";

	return <StateChip tone={tone}>{priority}</StateChip>;
}
