/**
 * Types for pre-gathering operations
 */

import type { DataProvider } from "../../../types/data-provider.js";
import type { IntegrationContext, InvestigationState } from "../../../types/index.js";

/**
 * Timeout configuration for pre-gathering operations
 */
export const PRE_GATHER_TIMEOUTS = {
	/** Maximum time for fetching full alert details */
	ALERTS: 15_000,
	/** Maximum time for fetching recent changes */
	CHANGES: 20_000,
	/** Maximum time for finding similar incidents */
	SIMILAR_INCIDENTS: 15_000,
	/** Maximum time for fetching service context */
	SERVICE_CONTEXT: 10_000,
	/** Maximum time for calculating metrics */
	METRICS: 5_000,
	/** Maximum time for previewing logs */
	LOGS: 20_000,
	/** Overall maximum time for all pre-gathering */
	TOTAL: 60_000,
} as const;

/**
 * Risk score thresholds for change correlation (BigPanda pattern)
 */
export const CHANGE_RISK_THRESHOLDS = {
	/** High risk - strongly recommend investigation */
	HIGH: 70,
	/** Medium risk - worth investigating */
	MEDIUM: 50,
	/** Low risk - less likely to be related */
	LOW: 30,
} as const;

/**
 * Similarity thresholds for incident matching (BigPanda pattern)
 */
export const SIMILARITY_THRESHOLDS = {
	/** High similarity - very likely related */
	HIGH: 70,
	/** Medium similarity - possibly related (BigPanda uses 30%) */
	MEDIUM: 30,
	/** Low similarity - unlikely related */
	LOW: 15,
} as const;

/**
 * Time windows for change correlation
 */
export const TIME_WINDOWS = {
	/** Changes within 1 hour - highest risk */
	ONE_HOUR_MINUTES: 60,
	/** Changes within 2 hours - high risk */
	TWO_HOURS_MINUTES: 120,
	/** Changes within 24 hours - moderate risk */
	ONE_DAY_MINUTES: 1440,
	/** Default time window for similar incident search */
	SIMILAR_INCIDENTS_DAYS: 30,
} as const;

/**
 * Result type for individual pre-gathering operations with error handling
 */
export interface GatherResult<T> {
	success: boolean;
	data: T | null;
	error?: string;
	durationMs: number;
}

/**
 * Common context passed to all gathering functions
 */
export interface GatheringContext {
	state: InvestigationState;
	incidentTime: Date;
	serviceId?: string;
	repository?: string;
	/** Data provider for fetching additional data during investigation */
	dataProvider: DataProvider;
	/**
	 * Available integrations for tools (GitHub, Render, etc.).
	 * Passed from RunnableConfig.configurable (NOT from state - prevents checkpoint leaks).
	 */
	integrations: IntegrationContext[];
}
