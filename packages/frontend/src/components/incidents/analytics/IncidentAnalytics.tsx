/**
 * Incident Analytics Container
 *
 * Main analytics dashboard showing stats cards and charts
 */

import { useMemo } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { IncidentWithRelations } from "@prismalens/contracts";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
	calculateAnalyticsSummary,
	formatDuration,
	formatTrend,
	getTrendColor,
} from "@/lib/analytics";
import { IncidentsOverTimeChart } from "./IncidentsOverTimeChart";
import { MTTRTrendChart } from "./MTTRTrendChart";
import { SeverityDistributionChart } from "./SeverityDistributionChart";
import { ServiceDistributionChart } from "./ServiceDistributionChart";

interface IncidentAnalyticsProps {
	incidents: IncidentWithRelations[];
	previousIncidents?: IncidentWithRelations[];
	days?: number;
	onSeverityFilter?: (severity: string) => void;
	onServiceFilter?: (serviceId: string) => void;
	className?: string;
}

interface StatCardProps {
	title: string;
	value: string | number;
	trend: number | null;
	trendLabel?: string;
	lowerIsBetter?: boolean;
}

function StatCard({
	title,
	value,
	trend,
	trendLabel = "vs previous period",
	lowerIsBetter = false,
}: StatCardProps) {
	const trendColor = getTrendColor(trend, lowerIsBetter);

	const TrendIcon =
		trend == null || trend === 0
			? Minus
			: trend > 0
				? TrendingUp
				: TrendingDown;

	return (
		<Card>
			<CardContent className="p-4">
				<p className="text-sm text-muted-foreground">{title}</p>
				<p className="text-2xl font-semibold mt-1">{value}</p>
				<div className={cn("flex items-center gap-1 mt-1 text-sm", trendColor)}>
					<TrendIcon className="h-3 w-3" />
					<span>{formatTrend(trend)}</span>
					<span className="text-muted-foreground text-xs">{trendLabel}</span>
				</div>
			</CardContent>
		</Card>
	);
}

export function IncidentAnalytics({
	incidents,
	previousIncidents = [],
	days = 30,
	onSeverityFilter,
	onServiceFilter,
	className,
}: IncidentAnalyticsProps) {
	const summary = useMemo(
		() => calculateAnalyticsSummary(incidents, previousIncidents),
		[incidents, previousIncidents]
	);

	return (
		<div className={cn("space-y-6", className)}>
			{/* Stats Cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					title="Total Incidents"
					value={summary.total}
					trend={summary.totalTrend}
				/>
				<StatCard
					title="MTTR"
					value={formatDuration(summary.mttr)}
					trend={summary.mttrTrend}
					lowerIsBetter
				/>
				<StatCard
					title="MTTA"
					value={formatDuration(summary.mtta)}
					trend={summary.mttaTrend}
					lowerIsBetter
				/>
				<StatCard
					title="AI-Assisted"
					value={`${summary.aiAssistedPercent}%`}
					trend={summary.aiAssistedTrend}
				/>
			</div>

			{/* Incidents Over Time Chart */}
			<IncidentsOverTimeChart incidents={incidents} days={days} />

			{/* Distribution Charts */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<SeverityDistributionChart
					incidents={incidents}
					onSeverityClick={onSeverityFilter}
				/>
				<ServiceDistributionChart
					incidents={incidents}
					onServiceClick={onServiceFilter}
				/>
			</div>

			{/* MTTR Trend Chart */}
			<MTTRTrendChart incidents={incidents} days={days} />
		</div>
	);
}
