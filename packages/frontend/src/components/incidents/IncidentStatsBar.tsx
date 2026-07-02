/**
 * Incident Stats Bar Component
 *
 * Displays incident statistics with clickable stats that filter the list.
 */

import type { IncidentWithRelations } from "@prismalens/contracts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface IncidentStatsBarProps {
	incidents: IncidentWithRelations[];
	onFilterStatus?: (status: string | undefined) => void;
	onFilterSeverity?: (severity: string | undefined) => void;
	activeStatusFilter?: string;
	activeSeverityFilter?: string;
	className?: string;
}

// Severity colors for the mini badges
const severityColors: Record<string, string> = {
	critical: "bg-red-500",
	high: "bg-orange-500",
	medium: "bg-yellow-500",
	low: "bg-blue-500",
	info: "bg-gray-500",
};

// Calculate MTTR from resolved incidents
function calculateMTTR(incidents: IncidentWithRelations[]): string {
	const resolvedIncidents = incidents.filter(
		(i) => i.timeToResolve !== null && i.timeToResolve > 0,
	);

	if (resolvedIncidents.length === 0) {
		return "-";
	}

	const totalMs = resolvedIncidents.reduce(
		(acc, i) => acc + (i.timeToResolve ?? 0),
		0,
	);
	const avgMs = totalMs / resolvedIncidents.length;
	const avgMins = Math.floor(avgMs / 60000);
	const avgHours = Math.floor(avgMins / 60);

	if (avgHours > 0) {
		return `${avgHours}h ${avgMins % 60}m`;
	}
	return `${avgMins}m`;
}

export function IncidentStatsBar({
	incidents,
	onFilterStatus,
	onFilterSeverity,
	activeStatusFilter,
	activeSeverityFilter,
	className,
}: IncidentStatsBarProps) {
	// Calculate stats
	const total = incidents.length;
	const activeStatuses = [
		"triggered",
		"investigating",
		"identified",
		"monitoring",
	];
	const activeCount = incidents.filter((i) =>
		activeStatuses.includes(i.status),
	).length;

	// Count by severity
	const bySeverity = incidents.reduce(
		(acc, i) => {
			acc[i.severity] = (acc[i.severity] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	);

	const mttr = calculateMTTR(incidents);

	return (
		<Card className={cn("p-4", className)}>
			<div className="flex flex-wrap items-center gap-4 divide-x divide-border">
				{/* Total */}
				<button
					type="button"
					onClick={() => {
						onFilterStatus?.(undefined);
						onFilterSeverity?.(undefined);
					}}
					className={cn(
						"flex flex-col items-center px-4 py-1 rounded-md transition-colors hover:bg-muted",
						!activeStatusFilter && !activeSeverityFilter && "bg-muted",
					)}
				>
					<span className="text-2xl font-bold">{total}</span>
					<span className="text-xs text-muted-foreground">Total</span>
				</button>

				{/* Active */}
				<button
					type="button"
					onClick={() => {
						onFilterStatus?.("active");
						onFilterSeverity?.(undefined);
					}}
					className={cn(
						"flex flex-col items-center px-4 py-1 rounded-md transition-colors hover:bg-muted pl-8",
						activeStatusFilter === "active" && "bg-muted",
					)}
				>
					<span className="text-2xl font-bold text-orange-500">
						{activeCount}
					</span>
					<span className="text-xs text-muted-foreground">Active</span>
				</button>

				{/* MTTR */}
				<div className="flex flex-col items-center px-4 py-1 pl-8">
					<span className="text-2xl font-bold">{mttr}</span>
					<span className="text-xs text-muted-foreground">Avg MTTR</span>
				</div>

				{/* By Severity */}
				<div className="flex items-center gap-2 pl-8">
					<span className="text-xs text-muted-foreground mr-2">
						By Severity:
					</span>
					{(["critical", "high", "medium", "low", "info"] as const).map(
						(severity) => {
							const count = bySeverity[severity] || 0;
							if (count === 0) return null;

							return (
								<button
									key={severity}
									type="button"
									onClick={() => {
										onFilterSeverity?.(
											activeSeverityFilter === severity ? undefined : severity,
										);
										onFilterStatus?.(undefined);
									}}
									className={cn(
										"flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-muted",
										activeSeverityFilter === severity &&
											"bg-muted ring-1 ring-primary",
									)}
								>
									<span
										className={cn(
											"w-2 h-2 rounded-full",
											severityColors[severity],
										)}
									/>
									<span className="text-sm font-medium">{count}</span>
								</button>
							);
						},
					)}
				</div>
			</div>
		</Card>
	);
}
