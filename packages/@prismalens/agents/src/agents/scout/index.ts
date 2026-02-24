/**
 * Scout node — standard baseline fetch + rich coverage metadata.
 *
 * Single graph node that always does the same fetch:
 * - Incident (1)
 * - Alerts (first 50, stratified sampling if more)
 * - Change events (4-hour window, optional)
 * - Similar incidents (5, optional)
 *
 * Produces rich structured coverage metadata as its primary output.
 * The LLM-driven gatherer (Phase 3+) uses this metadata to make
 * targeted follow-up data requests.
 */

import type { DataProvider } from "../../providers/data-provider.js"
import type { InvestigationState } from "../../types/state.js"
import { safeFetch } from "../../utils/safe-fetch.js"
import { sampleAlerts } from "./sampling.js"
import {
  computeAlertTimeline,
  extractServiceTopology,
  computeSeverityEscalation,
} from "./enrichments.js"
import { buildCoverageReport } from "./coverage.js"
import type { ScoutEnrichments } from "./types.js"

const ALERT_LIMIT = 50
const CHANGE_EVENT_WINDOW_HOURS = 4
const SIMILAR_INCIDENT_LIMIT = 5

/**
 * Create the scout function node.
 *
 * Closure over DataProvider — no LLM, no subgraph, no ToolNode.
 */
export function createScoutNode(dataProvider: DataProvider) {
  return async (
    state: InvestigationState,
  ): Promise<Partial<InvestigationState>> => {
    // 1. Parallel fetch all sources via safeFetch
    const [incidentResult, alertsResult, changeEventsResult, similarResult] =
      await Promise.all([
        safeFetch(
          () => dataProvider.fetchIncident(state.incidentId),
          null,
          "fetchIncident",
        ),
        safeFetch(
          () =>
            dataProvider.fetchAlerts({
              incidentId: state.incidentId,
              limit: ALERT_LIMIT,
            }),
          { alerts: [], hasMore: false },
          "fetchAlerts",
        ),
        safeFetch(
          () =>
            dataProvider.fetchChangeEvents?.(state.incidentId, {
              start: new Date(
                Date.now() - CHANGE_EVENT_WINDOW_HOURS * 3_600_000,
              ).toISOString(),
              end: new Date().toISOString(),
            }) ?? Promise.resolve([]),
          [],
          "fetchChangeEvents",
        ),
        safeFetch(
          () =>
            dataProvider.fetchSimilarIncidents?.({
              incidentId: state.incidentId,
              limit: SIMILAR_INCIDENT_LIMIT,
            }) ?? Promise.resolve({ incidents: [] }),
          { incidents: [] },
          "fetchSimilarIncidents",
        ),
      ])

    // 2. Early exit if incident not found (and fetch succeeded)
    if (!incidentResult.data && incidentResult.success) {
      return {
        errors: [`Incident not found: ${state.incidentId}`],
      }
    }

    // 3. Sample alerts if over limit
    const alerts = sampleAlerts(alertsResult.data.alerts, ALERT_LIMIT)

    // 4. Compute enrichments
    const timeline = computeAlertTimeline(alerts)
    const topology = extractServiceTopology(incidentResult.data, alerts)
    const escalation = computeSeverityEscalation(alerts)
    const enrichments: ScoutEnrichments = { timeline, topology, escalation }

    // 5. Determine alertsTotal for coverage
    // If hasMore is true, total is unknown (null). Otherwise total = fetched count.
    const alertsTotal = alertsResult.data.hasMore ? null : alerts.length

    // 6. Build rich coverage report
    const coverage = buildCoverageReport({
      incident: incidentResult.data,
      alerts,
      alertsTotal,
      changeEvents: changeEventsResult.data,
      similarIncidents: similarResult.data.incidents,
      fetchResults: {
        incidentSuccess: incidentResult.success,
        alertsSuccess: alertsResult.success,
        changeEventsQueried: !!dataProvider.fetchChangeEvents,
        changeEventsSuccess: changeEventsResult.success,
        similarIncidentsQueried: !!dataProvider.fetchSimilarIncidents,
        similarIncidentsSuccess: similarResult.success,
      },
      enrichments,
    })

    // 7. Collect errors from failed fetches
    const errors = [
      incidentResult,
      alertsResult,
      changeEventsResult,
      similarResult,
    ]
      .filter((r) => !r.success)
      .map((r) => r.error!)

    // 8. Build self-assessment
    const services = topology?.relatedServices ?? []
    const lastAgentResponse = {
      agent: "scout" as const,
      status: incidentResult.data ? ("completed" as const) : ("blocked" as const),
      summary:
        `Found ${alerts.length} alerts for incident "${incidentResult.data?.title ?? "unknown"}". ` +
        `Services affected: ${services.length > 0 ? services.join(", ") : "unknown"}.`,
      recommendation: "analyst" as const,
      reasoning:
        "Initial data collected from PrismaLens. Analyst should review alerts and determine what external data is needed.",
    }

    // 9. Return state update
    return {
      incident: incidentResult.data,
      alerts,
      gatheredData: {
        ...state.gatheredData,
        changeEvents: changeEventsResult.data,
        similarIncidents: similarResult.data.incidents,
        coverage,
      },
      lastAgentResponse,
      errors,
    }
  }
}
