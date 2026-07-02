/**
 * Incident Analytics Utilities
 *
 * Functions for calculating metrics and transforming incident data
 * for analytics charts and dashboards.
 */

import type { Incident, IncidentWithRelations } from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";
import {
	differenceInDays,
	format,
	parseISO,
	startOfDay,
	startOfWeek,
	subDays,
} from "date-fns";

// =============================================================================
// TYPES
// =============================================================================

export interface TimeSeriesDataPoint {
	date: string;
	label: string;
	value: number;
}

export interface PieChartDataPoint {
	name: string;
	value: number;
	color: string;
	[key: string]: string | number; // Index signature for recharts compatibility
}

export interface BarChartDataPoint {
	name: string;
	value: number;
	id?: string;
}

export interface MTTRDataPoint {
	date: string;
	label: string;
	mttr: number; // in minutes
	count: number; // incidents resolved that period
}

export interface AnalyticsSummary {
	total: number;
	totalTrend: number; // percentage change vs previous period
	mttr: number | null; // in minutes
	mttrTrend: number | null;
	mtta: number | null; // in minutes
	mttaTrend: number | null;
	aiAssistedPercent: number;
	aiAssistedTrend: number;
}

// =============================================================================
// SEVERITY COLORS
// =============================================================================

export const SEVERITY_COLORS: Record<string, string> = {
	critical: chartColors.severity.critical,
	high: chartColors.severity.high,
	medium: chartColors.severity.medium,
	low: chartColors.severity.low,
	info: chartColors.severity.info,
};

// =============================================================================
// METRIC CALCULATIONS
// =============================================================================

/**
 * Calculate Mean Time to Resolve (MTTR) in minutes
 * Only considers resolved incidents with timeToResolve data
 */
export function calculateMTTR(incidents: Incident[]): number | null {
	const resolvedWithTime = incidents.filter(
		(i) => i.status === "resolved" && i.timeToResolve != null,
	);

	if (resolvedWithTime.length === 0) return null;

	const totalMs = resolvedWithTime.reduce(
		(sum, i) => sum + (i.timeToResolve ?? 0),
		0,
	);
	return Math.round(totalMs / resolvedWithTime.length / 60000); // Convert ms to minutes
}

/**
 * Calculate Mean Time to Acknowledge (MTTA) in minutes
 * Only considers incidents with timeToAcknowledge data
 */
export function calculateMTTA(incidents: Incident[]): number | null {
	const acknowledgedWithTime = incidents.filter(
		(i) => i.timeToAcknowledge != null,
	);

	if (acknowledgedWithTime.length === 0) return null;

	const totalMs = acknowledgedWithTime.reduce(
		(sum, i) => sum + (i.timeToAcknowledge ?? 0),
		0,
	);
	return Math.round(totalMs / acknowledgedWithTime.length / 60000);
}

/**
 * Calculate percentage of incidents with AI investigations
 */
export function calculateAIAssistedPercent(
	incidents: IncidentWithRelations[],
): number {
	if (incidents.length === 0) return 0;

	const withInvestigations = incidents.filter(
		(i) => i.investigations && i.investigations.length > 0,
	);

	return Math.round((withInvestigations.length / incidents.length) * 100);
}

/**
 * Calculate trend percentage (positive = increase, negative = decrease)
 */
export function calculateTrendPercentage(
	current: number,
	previous: number,
): number {
	if (previous === 0) return current > 0 ? 100 : 0;
	return Math.round(((current - previous) / previous) * 100);
}

// =============================================================================
// TIME SERIES GROUPING
// =============================================================================

/**
 * Group incidents by date for time series chart
 */
export function groupIncidentsByDate(
	incidents: Incident[],
	granularity: "day" | "week" = "day",
	days: number = 30,
): TimeSeriesDataPoint[] {
	const now = new Date();
	const startDate = subDays(now, days);
	const dateMap = new Map<string, number>();

	// Initialize all dates with 0
	for (let i = 0; i <= days; i++) {
		const date = subDays(now, days - i);
		const key =
			granularity === "day"
				? format(startOfDay(date), "yyyy-MM-dd")
				: format(startOfWeek(date), "yyyy-MM-dd");
		dateMap.set(key, 0);
	}

	// Count incidents per date
	for (const incident of incidents) {
		const incidentDate = parseISO(incident.triggeredAt);
		if (incidentDate < startDate) continue;

		const key =
			granularity === "day"
				? format(startOfDay(incidentDate), "yyyy-MM-dd")
				: format(startOfWeek(incidentDate), "yyyy-MM-dd");

		dateMap.set(key, (dateMap.get(key) ?? 0) + 1);
	}

	// Convert to array sorted by date
	return Array.from(dateMap.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, value]) => ({
			date,
			label:
				granularity === "day"
					? format(parseISO(date), "MMM d")
					: format(parseISO(date), "MMM d"),
			value,
		}));
}

/**
 * Group MTTR by date for trend chart
 */
export function groupMTTRByDate(
	incidents: Incident[],
	granularity: "day" | "week" = "day",
	days: number = 30,
): MTTRDataPoint[] {
	const now = new Date();
	const startDate = subDays(now, days);
	const dateMap = new Map<string, { total: number; count: number }>();

	// Initialize all dates
	for (let i = 0; i <= days; i++) {
		const date = subDays(now, days - i);
		const key =
			granularity === "day"
				? format(startOfDay(date), "yyyy-MM-dd")
				: format(startOfWeek(date), "yyyy-MM-dd");
		dateMap.set(key, { total: 0, count: 0 });
	}

	// Sum timeToResolve per date
	for (const incident of incidents) {
		if (incident.status !== "resolved" || !incident.resolvedAt) continue;
		if (!incident.timeToResolve) continue;

		const resolvedDate = parseISO(incident.resolvedAt);
		if (resolvedDate < startDate) continue;

		const key =
			granularity === "day"
				? format(startOfDay(resolvedDate), "yyyy-MM-dd")
				: format(startOfWeek(resolvedDate), "yyyy-MM-dd");

		const existing = dateMap.get(key) ?? { total: 0, count: 0 };
		dateMap.set(key, {
			total: existing.total + incident.timeToResolve,
			count: existing.count + 1,
		});
	}

	// Convert to array with averages
	return Array.from(dateMap.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, { total, count }]) => ({
			date,
			label:
				granularity === "day"
					? format(parseISO(date), "MMM d")
					: format(parseISO(date), "MMM d"),
			mttr: count > 0 ? Math.round(total / count / 60000) : 0, // ms to minutes
			count,
		}));
}

// =============================================================================
// DISTRIBUTION GROUPING
// =============================================================================

/**
 * Group incidents by severity for pie chart
 */
export function groupIncidentsBySeverity(
	incidents: Incident[],
): PieChartDataPoint[] {
	const severityCount = new Map<string, number>();

	for (const incident of incidents) {
		const severity = incident.severity ?? "info";
		severityCount.set(severity, (severityCount.get(severity) ?? 0) + 1);
	}

	// Order by severity level
	const severityOrder = ["critical", "high", "medium", "low", "info"];

	return severityOrder
		.filter((s) => severityCount.has(s))
		.map((severity) => ({
			name: severity.charAt(0).toUpperCase() + severity.slice(1),
			value: severityCount.get(severity) ?? 0,
			color: SEVERITY_COLORS[severity] ?? chartColors.muted,
		}));
}

/**
 * Group incidents by service for bar chart
 */
export function groupIncidentsByService(
	incidents: IncidentWithRelations[],
): BarChartDataPoint[] {
	const serviceCount = new Map<string, { count: number; id: string | null }>();

	for (const incident of incidents) {
		const serviceName = incident.service?.name ?? "Unknown";
		const serviceId = incident.serviceId;
		const existing = serviceCount.get(serviceName) ?? { count: 0, id: null };
		serviceCount.set(serviceName, {
			count: existing.count + 1,
			id: serviceId ?? existing.id,
		});
	}

	// Sort by count descending, limit to top 10
	return Array.from(serviceCount.entries())
		.sort(([, a], [, b]) => b.count - a.count)
		.slice(0, 10)
		.map(([name, { count, id }]) => ({
			name,
			value: count,
			id: id ?? undefined,
		}));
}

// =============================================================================
// SUMMARY CALCULATION
// =============================================================================

/**
 * Calculate analytics summary with trends
 * Compares current period to previous period of same length
 */
export function calculateAnalyticsSummary(
	currentIncidents: IncidentWithRelations[],
	previousIncidents: IncidentWithRelations[],
): AnalyticsSummary {
	const currentTotal = currentIncidents.length;
	const previousTotal = previousIncidents.length;

	const currentMTTR = calculateMTTR(currentIncidents);
	const previousMTTR = calculateMTTR(previousIncidents);

	const currentMTTA = calculateMTTA(currentIncidents);
	const previousMTTA = calculateMTTA(previousIncidents);

	const currentAIPercent = calculateAIAssistedPercent(currentIncidents);
	const previousAIPercent = calculateAIAssistedPercent(previousIncidents);

	return {
		total: currentTotal,
		totalTrend: calculateTrendPercentage(currentTotal, previousTotal),
		mttr: currentMTTR,
		mttrTrend:
			currentMTTR != null && previousMTTR != null
				? calculateTrendPercentage(currentMTTR, previousMTTR)
				: null,
		mtta: currentMTTA,
		mttaTrend:
			currentMTTA != null && previousMTTA != null
				? calculateTrendPercentage(currentMTTA, previousMTTA)
				: null,
		aiAssistedPercent: currentAIPercent,
		aiAssistedTrend: calculateTrendPercentage(
			currentAIPercent,
			previousAIPercent,
		),
	};
}

// =============================================================================
// FORMATTING UTILITIES
// =============================================================================

/**
 * Format duration in minutes to human readable string
 */
export function formatDuration(minutes: number | null): string {
	if (minutes == null) return "-";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Format trend percentage with + or - prefix
 */
export function formatTrend(trend: number | null): string {
	if (trend == null) return "-";
	const prefix = trend > 0 ? "+" : "";
	return `${prefix}${trend}%`;
}

/**
 * Get trend color class
 * For MTTR/MTTA: negative is good (green), positive is bad (red)
 * For total/AI-assisted: depends on context
 */
export function getTrendColor(
	trend: number | null,
	lowerIsBetter: boolean = false,
): string {
	if (trend == null) return "text-muted-foreground";
	if (trend === 0) return "text-muted-foreground";

	if (lowerIsBetter) {
		return trend < 0 ? "text-green-600" : "text-red-600";
	}
	return trend > 0 ? "text-green-600" : "text-red-600";
}
