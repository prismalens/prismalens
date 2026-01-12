import { Badge } from "@/components/ui/badge";
import type { Severity } from "@prismalens/contracts";
import { cn } from "@/lib/utils";

export interface SeverityBadgeProps {
	severity: Severity;
	className?: string;
}

const severityConfig: Record<
	Severity,
	{ label: string; variant: "default" | "destructive" | "outline" | "secondary"; className: string }
> = {
	critical: {
		label: "Critical",
		variant: "destructive",
		className: "bg-red-600 hover:bg-red-600 text-white",
	},
	high: {
		label: "High",
		variant: "destructive",
		className: "bg-orange-500 hover:bg-orange-500 text-white",
	},
	medium: {
		label: "Medium",
		variant: "default",
		className: "bg-yellow-500 hover:bg-yellow-500 text-black",
	},
	low: {
		label: "Low",
		variant: "secondary",
		className: "bg-blue-500 hover:bg-blue-500 text-white",
	},
	info: {
		label: "Info",
		variant: "outline",
		className: "bg-gray-500 hover:bg-gray-500 text-white",
	},
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
	const config = severityConfig[severity] || severityConfig.info;

	return (
		<Badge
			variant={config.variant}
			className={cn(config.className, className)}
		>
			{config.label}
		</Badge>
	);
}
