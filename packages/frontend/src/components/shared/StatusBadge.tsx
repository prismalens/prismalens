// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertStatus, IncidentStatus } from "@prismalens/contracts";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface StatusBadgeProps {
	status: AlertStatus | IncidentStatus;
	className?: string;
}

const statusConfig: Record<
	string,
	{
		label: string;
		variant: "default" | "destructive" | "outline" | "secondary";
		className: string;
	}
> = {
	// Alert statuses
	triggered: {
		label: "Triggered",
		variant: "destructive",
		className: "bg-red-600 hover:bg-red-600 text-white",
	},
	acknowledged: {
		label: "Acknowledged",
		variant: "default",
		className: "bg-blue-600 hover:bg-blue-600 text-white",
	},
	correlated: {
		label: "Correlated",
		variant: "secondary",
		className: "bg-purple-600 hover:bg-purple-600 text-white",
	},
	resolved: {
		label: "Resolved",
		variant: "outline",
		className: "bg-green-600 hover:bg-green-600 text-white",
	},
	suppressed: {
		label: "Suppressed",
		variant: "outline",
		className: "bg-gray-500 hover:bg-gray-500 text-white",
	},
	// Incident statuses
	investigating: {
		label: "Investigating",
		variant: "default",
		className: "bg-yellow-600 hover:bg-yellow-600 text-white",
	},
	identified: {
		label: "Identified",
		variant: "default",
		className: "bg-orange-500 hover:bg-orange-500 text-white",
	},
	monitoring: {
		label: "Monitoring",
		variant: "secondary",
		className: "bg-cyan-600 hover:bg-cyan-600 text-white",
	},
	closed: {
		label: "Closed",
		variant: "outline",
		className: "bg-gray-600 hover:bg-gray-600 text-white",
	},
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
	const config = statusConfig[status] || {
		label: status,
		variant: "outline" as const,
		className: "bg-gray-500 hover:bg-gray-500 text-white",
	};

	return (
		<Badge variant={config.variant} className={cn(config.className, className)}>
			{config.label}
		</Badge>
	);
}
