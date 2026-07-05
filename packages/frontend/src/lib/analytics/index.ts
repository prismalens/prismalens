// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Analytics Utilities
 *
 * Data aggregation and formatting functions for analytics dashboards
 */

export {
	// Types
	type AnalyticsSummary,
	type BarChartDataPoint,
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
	groupIncidentsByService,
	groupIncidentsBySeverity,
	groupMTTRByDate,
	type MTTRDataPoint,
	type PieChartDataPoint,
	// Constants
	SEVERITY_COLORS,
	type TimeSeriesDataPoint,
} from "./incident-analytics";
