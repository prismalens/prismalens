// =============================================================================
// DATA PROVIDER INTERFACE
// =============================================================================
// Abstraction for fetching additional data during investigation.
// Enables agents to request more data when initial input is incomplete.
//
// Implementations:
// - DirectDataProvider (API): Uses NestJS services directly
// - WorkerDataProvider (Worker): Uses oRPC client to call API
// =============================================================================

import type { AlertContext, IncidentContext } from "./schemas/core.js";
import type { SimilarIncidentMatch } from "./schemas/pre-gathering.js";

/**
 * Request to fetch additional alerts
 */
export interface AlertFetchRequest {
	/** Specific alert IDs to fetch */
	alertIds?: string[];
	/** Incident ID to fetch all alerts for */
	incidentId?: string;
	/** Time range filter */
	timeRange?: {
		start: string; // ISO timestamp
		end: string;
	};
	/** Service filter */
	serviceId?: string;
	/** Maximum results to return */
	limit?: number;
}

/**
 * Response from fetching alerts
 */
export interface AlertFetchResponse {
	/** Fetched alerts */
	alerts: AlertContext[];
	/** Whether there are more alerts available */
	hasMore: boolean;
}

/**
 * Request to fetch similar incidents for pattern matching
 */
export interface SimilarIncidentRequest {
	/** Current incident ID (to exclude from results) */
	incidentId: string;
	/** Service to search in */
	serviceId?: string;
	/** Minimum similarity threshold (0-100) */
	similarityThreshold?: number;
	/** Maximum results to return */
	limit?: number;
}

/**
 * Response from fetching similar incidents
 */
export interface SimilarIncidentResponse {
	/** Similar incidents found */
	incidents: SimilarIncidentMatch[];
}

/**
 * Data provider interface for fetching additional data during investigation.
 *
 * This interface abstracts the data fetching mechanism, allowing the same
 * agent code to work in both:
 * - Direct mode: Uses NestJS services directly (no network)
 * - Queue mode: Uses oRPC client to call API (network call)
 *
 * REQUIRED - callers must provide an implementation. There is no default
 * or null implementation to ensure fail-fast behavior if data fetching
 * is needed but not configured.
 *
 * @example
 * ```typescript
 * // In QueueService (direct mode)
 * const dataProvider = new DirectDataProvider(alertsService, incidentsService);
 *
 * // In Worker (queue mode)
 * const dataProvider = new WorkerDataProvider(api);
 *
 * // Pass to executor
 * const executor = new InvestigationExecutor({ dataProvider });
 * ```
 */
export interface DataProvider {
	/**
	 * Fetch alerts based on criteria.
	 *
	 * Use cases:
	 * - Fetch all alerts for an incident (when initial data is incomplete)
	 * - Fetch alerts by time range (for timeline analysis)
	 * - Fetch alerts by service (for dependency analysis)
	 *
	 * @param request - Fetch criteria
	 * @returns Alerts matching the criteria
	 */
	fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse>;

	/**
	 * Fetch a single incident with full details.
	 *
	 * Use cases:
	 * - Get full incident context when only ID was passed
	 * - Refresh incident data if it may have been updated
	 *
	 * @param incidentId - ID of the incident to fetch
	 * @returns Incident context or null if not found
	 */
	fetchIncident(incidentId: string): Promise<IncidentContext | null>;

	/**
	 * Fetch similar past incidents for pattern matching.
	 *
	 * Use cases:
	 * - Find incidents with similar symptoms
	 * - Learn from past resolutions
	 * - Identify recurring patterns
	 *
	 * @param request - Search criteria
	 * @returns Similar incidents with similarity scores
	 */
	fetchSimilarIncidents(
		request: SimilarIncidentRequest,
	): Promise<SimilarIncidentResponse>;
}
