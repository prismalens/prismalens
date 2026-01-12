import type { AlertStatus, Severity } from "@prismalens/contracts";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export interface AlertFiltersProps {
	status: AlertStatus | "all";
	severity: Severity | "all";
	onStatusChange: (status: AlertStatus | "all") => void;
	onSeverityChange: (severity: Severity | "all") => void;
	onClear: () => void;
}

const statusOptions: { value: AlertStatus | "all"; label: string }[] = [
	{ value: "all", label: "All Statuses" },
	{ value: "triggered", label: "Triggered" },
	{ value: "acknowledged", label: "Acknowledged" },
	{ value: "correlated", label: "Correlated" },
	{ value: "resolved", label: "Resolved" },
	{ value: "suppressed", label: "Suppressed" },
];

const severityOptions: { value: Severity | "all"; label: string }[] = [
	{ value: "all", label: "All Severities" },
	{ value: "critical", label: "Critical" },
	{ value: "high", label: "High" },
	{ value: "medium", label: "Medium" },
	{ value: "low", label: "Low" },
	{ value: "info", label: "Info" },
];

export function AlertFilters({
	status,
	severity,
	onStatusChange,
	onSeverityChange,
	onClear,
}: AlertFiltersProps) {
	const hasFilters = status !== "all" || severity !== "all";

	return (
		<div className="flex items-center gap-4">
			<Select value={status} onValueChange={(v) => onStatusChange(v as AlertStatus | "all")}>
				<SelectTrigger className="w-[180px]">
					<SelectValue placeholder="Filter by status" />
				</SelectTrigger>
				<SelectContent>
					{statusOptions.map((opt) => (
						<SelectItem key={opt.value} value={opt.value}>
							{opt.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			<Select value={severity} onValueChange={(v) => onSeverityChange(v as Severity | "all")}>
				<SelectTrigger className="w-[180px]">
					<SelectValue placeholder="Filter by severity" />
				</SelectTrigger>
				<SelectContent>
					{severityOptions.map((opt) => (
						<SelectItem key={opt.value} value={opt.value}>
							{opt.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{hasFilters && (
				<Button variant="ghost" size="sm" onClick={onClear}>
					<X className="h-4 w-4 mr-1" />
					Clear filters
				</Button>
			)}
		</div>
	);
}
