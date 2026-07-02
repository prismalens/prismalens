/**
 * Incident Filters Component
 *
 * Filter controls for the incidents list page
 */

import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface IncidentFiltersProps {
	status: IncidentStatus | "all";
	severity: Severity | "all";
	priority: Priority | "all";
	onStatusChange: (status: IncidentStatus | "all") => void;
	onSeverityChange: (severity: Severity | "all") => void;
	onPriorityChange: (priority: Priority | "all") => void;
	onClear: () => void;
}

const incidentStatuses: { value: IncidentStatus | "all"; label: string }[] = [
	{ value: "all", label: "All Statuses" },
	{ value: "triggered", label: "Triggered" },
	{ value: "investigating", label: "Investigating" },
	{ value: "identified", label: "Identified" },
	{ value: "monitoring", label: "Monitoring" },
	{ value: "resolved", label: "Resolved" },
	{ value: "closed", label: "Closed" },
];

const severities: { value: Severity | "all"; label: string }[] = [
	{ value: "all", label: "All Severities" },
	{ value: "critical", label: "Critical" },
	{ value: "high", label: "High" },
	{ value: "medium", label: "Medium" },
	{ value: "low", label: "Low" },
	{ value: "info", label: "Info" },
];

const priorities: { value: Priority | "all"; label: string }[] = [
	{ value: "all", label: "All Priorities" },
	{ value: "p1", label: "P1 - Critical" },
	{ value: "p2", label: "P2 - High" },
	{ value: "p3", label: "P3 - Medium" },
	{ value: "p4", label: "P4 - Low" },
	{ value: "p5", label: "P5 - Planning" },
];

export function IncidentFilters({
	status,
	severity,
	priority,
	onStatusChange,
	onSeverityChange,
	onPriorityChange,
	onClear,
}: IncidentFiltersProps) {
	const hasFilters =
		status !== "all" || severity !== "all" || priority !== "all";

	return (
		<div className="flex flex-wrap items-center gap-3">
			{/* Status Filter */}
			<Select value={status} onValueChange={onStatusChange}>
				<SelectTrigger className="w-[160px]">
					<SelectValue placeholder="Filter by status" />
				</SelectTrigger>
				<SelectContent>
					{incidentStatuses.map((s) => (
						<SelectItem key={s.value} value={s.value}>
							{s.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{/* Severity Filter */}
			<Select value={severity} onValueChange={onSeverityChange}>
				<SelectTrigger className="w-[160px]">
					<SelectValue placeholder="Filter by severity" />
				</SelectTrigger>
				<SelectContent>
					{severities.map((s) => (
						<SelectItem key={s.value} value={s.value}>
							{s.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{/* Priority Filter */}
			<Select value={priority} onValueChange={onPriorityChange}>
				<SelectTrigger className="w-[160px]">
					<SelectValue placeholder="Filter by priority" />
				</SelectTrigger>
				<SelectContent>
					{priorities.map((p) => (
						<SelectItem key={p.value} value={p.value}>
							{p.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{/* Clear Button */}
			{hasFilters && (
				<Button variant="ghost" size="sm" onClick={onClear}>
					<X className="h-4 w-4 mr-1" />
					Clear
				</Button>
			)}
		</div>
	);
}
