/**
 * MockDataProvider — serves scenario data to the scout node.
 *
 * Implements DataProvider interface. Returns embedded scenario data
 * directly — no database or network calls.
 */

import type {
  DataProvider,
  AlertFetchRequest,
  AlertFetchResponse,
  SimilarIncidentRequest,
  SimilarIncidentResponse,
  ChangeEventContext,
} from "../../providers/data-provider.js"
import type { IncidentContext } from "../../types/contexts.js"
import type { ScenarioDefinition } from "./types.js"

export class MockDataProvider implements DataProvider {
  private readonly scenario: ScenarioDefinition

  constructor(scenario: ScenarioDefinition) {
    this.scenario = scenario
  }

  async fetchIncident(incidentId: string): Promise<IncidentContext | null> {
    if (incidentId !== this.scenario.incident.incidentId) return null
    return this.scenario.incident
  }

  async fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse> {
    const limit = request.limit ?? 50
    const alerts = this.scenario.alerts.slice(0, limit)
    return {
      alerts,
      hasMore: this.scenario.alerts.length > limit,
    }
  }

  async fetchSimilarIncidents(
    _request: SimilarIncidentRequest,
  ): Promise<SimilarIncidentResponse> {
    return {
      incidents: this.scenario.similarIncidents ?? [],
    }
  }

  async fetchChangeEvents(
    _incidentId: string,
    _timeRange?: { start: string; end: string },
  ): Promise<ChangeEventContext[]> {
    return this.scenario.changeEvents ?? []
  }
}
