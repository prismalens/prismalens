/**
 * DataProvider interface — abstraction for fetching incident data.
 *
 * Two implementations exist outside this package:
 * - DirectDataProvider (API package): Direct database access via NestJS services
 * - WorkerDataProvider (Worker package): oRPC calls to the API
 *
 * Scout node uses DataProvider to fetch incident + alerts at investigation start.
 */

import type {
  IncidentContext,
  AlertContext,
  SimilarIncidentMatch,
} from "../types/contexts.js"

/**
 * Request for fetching alerts associated with an incident.
 */
export interface AlertFetchRequest {
  incidentId?: string
  serviceId?: string
  limit?: number
}

/**
 * Response from fetching alerts.
 */
export interface AlertFetchResponse {
  alerts: AlertContext[]
  hasMore: boolean
}

/**
 * Request for searching similar past incidents.
 */
export interface SimilarIncidentRequest {
  incidentId: string
  serviceId?: string
  title?: string
  severity?: string
  limit?: number
}

/**
 * Response from similar incident search.
 */
export interface SimilarIncidentResponse {
  incidents: SimilarIncidentMatch[]
}

/**
 * DataProvider interface — injected into InvestigationExecutor.
 *
 * Consumers (API QueueService, Worker) implement this interface
 * to bridge between their data access layer and the agents package.
 */
export interface DataProvider {
  /**
   * Fetch incident context by ID.
   * Returns null if incident not found.
   */
  fetchIncident(incidentId: string): Promise<IncidentContext | null>

  /**
   * Fetch alerts associated with an incident.
   */
  fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse>

  /**
   * Search for similar past incidents (optional).
   * Returns empty incidents if not implemented.
   */
  fetchSimilarIncidents?(
    request: SimilarIncidentRequest,
  ): Promise<SimilarIncidentResponse>
}

/**
 * Stub DataProvider for LangGraph Studio and testing.
 * Returns mock data so the graph can execute without real data sources.
 */
export class StubDataProvider implements DataProvider {
  async fetchIncident(incidentId: string): Promise<IncidentContext | null> {
    return {
      incidentId,
      number: 1,
      title: "Stub incident for development",
      description: "This is a stub incident from StubDataProvider",
      severity: "medium",
      status: "investigating",
      priority: "p3",
      alertCount: 1,
      triggeredAt: new Date().toISOString(),
    }
  }

  async fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse> {
    return {
      alerts: [
        {
          alertId: `stub-alert-${request.incidentId ?? "unknown"}`,
          title: "Stub alert for development",
          severity: "medium",
          status: "triggered",
          triggeredAt: new Date().toISOString(),
        },
      ],
      hasMore: false,
    }
  }

  async fetchSimilarIncidents(): Promise<SimilarIncidentResponse> {
    return { incidents: [] }
  }
}
