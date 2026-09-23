// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	type AlertStatus,
	AlertStatusSchema,
	enumOptions,
	SEVERITY_LABEL,
	type Severity,
	SeveritySchema,
} from "@prismalens/contracts";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface AlertFiltersProps {
	status: AlertStatus | "all";
	severity: Severity | "all";
	onStatusChange: (status: AlertStatus | "all") => void;
	onSeverityChange: (severity: Severity | "all") => void;
	onClear: () => void;
}

const statusOptions: { value: AlertStatus | "all"; label: string }[] = [
	{ value: "all", label: "All Statuses" },
	...enumOptions(AlertStatusSchema, ALERT_STATUS_LABEL),
];

const severityOptions: { value: Severity | "all"; label: string }[] = [
	{ value: "all", label: "All Severities" },
	...enumOptions(SeveritySchema, SEVERITY_LABEL),
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
			<Select
				value={status}
				onValueChange={(v) => onStatusChange(v as AlertStatus | "all")}
			>
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

			<Select
				value={severity}
				onValueChange={(v) => onSeverityChange(v as Severity | "all")}
			>
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
