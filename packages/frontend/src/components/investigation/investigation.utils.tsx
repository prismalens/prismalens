import { Activity, AlertCircle, CheckCircle, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function InvestigationStatusBadge({ status }: { status: string }) {
	const statusConfig = {
		completed: {
			icon: CheckCircle,
			variant: "secondary" as const,
			className:
				"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		},
		running: {
			icon: Activity,
			variant: "secondary" as const,
			className:
				"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		failed: {
			icon: AlertCircle,
			variant: "destructive" as const,
			className: "",
		},
		pending: {
			icon: Clock,
			variant: "secondary" as const,
			className:
				"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		},
	};

	const config =
		statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<Badge variant={config.variant} className={config.className}>
			<Icon className="w-3 h-3 mr-1" />
			{status}
		</Badge>
	);
}

export function PriorityBadge({ priority }: { priority: string }) {
	const colors: Record<string, string> = {
		critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
		medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	};

	return (
		<Badge
			variant="secondary"
			className={colors[priority.toLowerCase()] || colors.medium}
		>
			{priority}
		</Badge>
	);
}
