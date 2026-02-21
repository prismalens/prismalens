/**
 * Coverage report builder — the scout's primary output.
 *
 * Computes per-source coverage metadata, data completeness,
 * service detection, and data gaps from fetch results.
 */

import type { AlertContext, IncidentContext } from "../../types/contexts.js"
import type { SimilarIncidentMatch } from "../../types/contexts.js"
import type { ChangeEventContext } from "../../providers/data-provider.js"
import type { DataCoverage, SourceCoverage } from "../../types/state.js"
import type { ScoutEnrichments } from "./types.js"

export interface CoverageInput {
  incident: IncidentContext | null
  alerts: AlertContext[]
  alertsTotal: number | null
  changeEvents: ChangeEventContext[]
  similarIncidents: SimilarIncidentMatch[]
  fetchResults: {
    incidentSuccess: boolean
    alertsSuccess: boolean
    changeEventsQueried: boolean
    changeEventsSuccess: boolean
    similarIncidentsQueried: boolean
    similarIncidentsSuccess: boolean
  }
  enrichments: ScoutEnrichments
}

/** Sources deferred to the LLM-driven gatherer (Phase 3+). */
const DEFERRED_SOURCES = [
  "logs",
  "commits",
  "deployments",
  "metrics",
  "codeSearchResults",
]

export function buildCoverageReport(input: CoverageInput): DataCoverage {
  const { incident, alerts, alertsTotal, changeEvents, similarIncidents, fetchResults, enrichments } = input

  // Per-source coverage
  const alertsCoverage: SourceCoverage = {
    fetched: alerts.length,
    total: alertsTotal,
    sampled: alertsTotal !== null && alerts.length < alertsTotal,
  }

  const changeEventsCoverage: SourceCoverage | null = fetchResults.changeEventsQueried
    ? {
        fetched: changeEvents.length,
        total: changeEvents.length, // we fetch all within the time window
        sampled: false,
      }
    : null

  const similarIncidentsCoverage: SourceCoverage | null = fetchResults.similarIncidentsQueried
    ? {
        fetched: similarIncidents.length,
        total: null, // we don't know total similar incidents
        sampled: false,
      }
    : null

  // Service detection
  const serviceIds = new Set<string>()
  if (incident?.serviceId) serviceIds.add(incident.serviceId)
  for (const alert of alerts) {
    if (alert.serviceId) serviceIds.add(alert.serviceId)
  }
  const detected = [...serviceIds]

  // Data gaps
  const dataGaps: string[] = []

  if (!fetchResults.incidentSuccess) dataGaps.push("incident")
  if (!fetchResults.alertsSuccess || alerts.length === 0) dataGaps.push("alerts")

  if (!fetchResults.changeEventsQueried) {
    dataGaps.push("changeEvents")
  } else if (!fetchResults.changeEventsSuccess || changeEvents.length === 0) {
    dataGaps.push("changeEvents")
  }

  if (!fetchResults.similarIncidentsQueried) {
    dataGaps.push("similarIncidents")
  } else if (!fetchResults.similarIncidentsSuccess || similarIncidents.length === 0) {
    dataGaps.push("similarIncidents")
  }

  // Always include deferred sources as gaps
  dataGaps.push(...DEFERRED_SOURCES)

  // Data completeness
  const anyFailure =
    !fetchResults.incidentSuccess ||
    !fetchResults.alertsSuccess ||
    (fetchResults.changeEventsQueried && !fetchResults.changeEventsSuccess) ||
    (fetchResults.similarIncidentsQueried && !fetchResults.similarIncidentsSuccess)

  const anyNotQueried =
    !fetchResults.changeEventsQueried || !fetchResults.similarIncidentsQueried

  let dataCompleteness: DataCoverage["dataCompleteness"]
  if (anyFailure || anyNotQueried) {
    dataCompleteness = "partial"
  } else if (alertsCoverage.sampled) {
    dataCompleteness = "sampled"
  } else {
    dataCompleteness = "complete"
  }

  return {
    incident: { found: incident !== null },
    alerts: alertsCoverage,
    changeEvents: changeEventsCoverage,
    similarIncidents: similarIncidentsCoverage,
    services: { detected, count: detected.length },
    dataCompleteness,
    dataGaps,
    temporalOverlap: enrichments.timeline !== null,
  }
}
