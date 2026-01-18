/**
 * Analytics Utilities
 *
 * Data aggregation and formatting functions for analytics dashboards
 */

export {
	// Types
	type AnalyticsSummary,
	type BarChartDataPoint,
	type MTTRDataPoint,
	type PieChartDataPoint,
	type TimeSeriesDataPoint,
	// Metrics
	calculateAIAssistedPercent,
	calculateAnalyticsSummary,
	calculateMTTA,
	calculateMTTR,
	calculateTrendPercentage,
	// Formatting
	formatDuration,
	formatTrend,
	getTrendColor,
	// Grouping
	groupIncidentsByDate,
	groupIncidentsBySeverity,
	groupIncidentsByService,
	groupMTTRByDate,
	// Constants
	SEVERITY_COLORS,
} from "./incident-analytics";
