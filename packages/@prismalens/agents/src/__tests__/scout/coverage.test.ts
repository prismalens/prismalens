import { describe, it, expect } from "vitest"
import { buildCoverageReport, type CoverageInput } from "../../agents/scout/coverage.js"
import type { AlertContext, IncidentContext } from "../../types/contexts.js"

function makeAlert(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    alertId: "a1",
    title: "Test alert",
    severity: "medium",
    status: "triggered",
    triggeredAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeIncident(overrides: Partial<IncidentContext> = {}): IncidentContext {
  return {
    incidentId: "inc-1",
    number: 1,
    title: "Test incident",
    severity: "medium",
    status: "investigating",
    priority: "p3",
    alertCount: 1,
    triggeredAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeInput(overrides: Partial<CoverageInput> = {}): CoverageInput {
  return {
    incident: makeIncident(),
    alerts: [makeAlert()],
    alertsTotal: 1,
    changeEvents: [],
    similarIncidents: [],
    fetchResults: {
      incidentSuccess: true,
      alertsSuccess: true,
      changeEventsQueried: true,
      changeEventsSuccess: true,
      similarIncidentsQueried: true,
      similarIncidentsSuccess: true,
    },
    enrichments: { timeline: null, topology: null, escalation: null },
    ...overrides,
  }
}

describe("buildCoverageReport", () => {
  it("reports complete when all sources queried and no sampling", () => {
    const coverage = buildCoverageReport(makeInput())
    expect(coverage.dataCompleteness).toBe("complete")
    expect(coverage.incident.found).toBe(true)
    expect(coverage.alerts.sampled).toBe(false)
    expect(coverage.alerts.fetched).toBe(1)
  })

  it("reports sampled when alerts total > fetched", () => {
    const coverage = buildCoverageReport(
      makeInput({
        alerts: [makeAlert(), makeAlert()],
        alertsTotal: 100,
      }),
    )
    expect(coverage.dataCompleteness).toBe("sampled")
    expect(coverage.alerts.sampled).toBe(true)
    expect(coverage.alerts.fetched).toBe(2)
    expect(coverage.alerts.total).toBe(100)
  })

  it("reports partial when a fetch fails", () => {
    const coverage = buildCoverageReport(
      makeInput({
        fetchResults: {
          incidentSuccess: true,
          alertsSuccess: false,
          changeEventsQueried: true,
          changeEventsSuccess: true,
          similarIncidentsQueried: true,
          similarIncidentsSuccess: true,
        },
      }),
    )
    expect(coverage.dataCompleteness).toBe("partial")
  })

  it("reports partial when optional source not queried", () => {
    const coverage = buildCoverageReport(
      makeInput({
        fetchResults: {
          incidentSuccess: true,
          alertsSuccess: true,
          changeEventsQueried: false,
          changeEventsSuccess: false,
          similarIncidentsQueried: true,
          similarIncidentsSuccess: true,
        },
      }),
    )
    expect(coverage.dataCompleteness).toBe("partial")
    expect(coverage.changeEvents).toBeNull()
  })

  it("detects services from incident and alerts", () => {
    const coverage = buildCoverageReport(
      makeInput({
        incident: makeIncident({ serviceId: "svc-a" }),
        alerts: [
          makeAlert({ serviceId: "svc-a" }),
          makeAlert({ serviceId: "svc-b" }),
        ],
      }),
    )
    expect(coverage.services.detected).toContain("svc-a")
    expect(coverage.services.detected).toContain("svc-b")
    expect(coverage.services.count).toBe(2)
  })

  it("includes deferred sources in dataGaps", () => {
    const coverage = buildCoverageReport(makeInput())
    expect(coverage.dataGaps).toContain("logs")
    expect(coverage.dataGaps).toContain("commits")
    expect(coverage.dataGaps).toContain("deployments")
    expect(coverage.dataGaps).toContain("metrics")
    expect(coverage.dataGaps).toContain("codeSearchResults")
  })

  it("adds failed sources to dataGaps", () => {
    const coverage = buildCoverageReport(
      makeInput({
        alerts: [],
        fetchResults: {
          incidentSuccess: true,
          alertsSuccess: true,
          changeEventsQueried: true,
          changeEventsSuccess: false,
          similarIncidentsQueried: true,
          similarIncidentsSuccess: true,
        },
      }),
    )
    expect(coverage.dataGaps).toContain("alerts") // 0 alerts
    expect(coverage.dataGaps).toContain("changeEvents") // fetch failed
  })

  it("sets temporalOverlap from enrichments timeline", () => {
    const withTimeline = buildCoverageReport(
      makeInput({
        enrichments: {
          timeline: {
            firstAlert: "2024-01-01T00:00:00Z",
            latestAlert: "2024-01-01T01:00:00Z",
            durationMs: 3600000,
            alertsPerMinute: 1,
            escalationPattern: "stable",
          },
          topology: null,
          escalation: null,
        },
      }),
    )
    expect(withTimeline.temporalOverlap).toBe(true)

    const withoutTimeline = buildCoverageReport(makeInput())
    expect(withoutTimeline.temporalOverlap).toBe(false)
  })

  it("handles incident not found", () => {
    const coverage = buildCoverageReport(
      makeInput({
        incident: null,
        fetchResults: {
          incidentSuccess: true,
          alertsSuccess: true,
          changeEventsQueried: true,
          changeEventsSuccess: true,
          similarIncidentsQueried: true,
          similarIncidentsSuccess: true,
        },
      }),
    )
    expect(coverage.incident.found).toBe(false)
  })
})
