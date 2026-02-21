import { describe, it, expect } from "vitest"
import {
  computeAlertTimeline,
  extractServiceTopology,
  computeSeverityEscalation,
} from "../../agents/scout/enrichments.js"
import type { AlertContext, IncidentContext } from "../../types/contexts.js"

function makeAlert(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    alertId: "a1",
    title: "Test alert",
    severity: "medium",
    status: "triggered",
    triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString(),
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
    triggeredAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    ...overrides,
  }
}

describe("computeAlertTimeline", () => {
  it("returns null for empty alerts", () => {
    expect(computeAlertTimeline([])).toBeNull()
  })

  it("returns zero duration for single alert", () => {
    const result = computeAlertTimeline([makeAlert()])
    expect(result).not.toBeNull()
    expect(result!.durationMs).toBe(0)
    expect(result!.alertsPerMinute).toBe(0)
    expect(result!.escalationPattern).toBe("stable")
  })

  it("computes duration and rate for multiple alerts", () => {
    const alerts = [
      makeAlert({ triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:05:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:10:00Z" }),
    ]
    const result = computeAlertTimeline(alerts)
    expect(result!.durationMs).toBe(10 * 60_000)
    expect(result!.alertsPerMinute).toBe(0.3)
    expect(result!.firstAlert).toBe("2024-01-01T00:00:00.000Z")
    expect(result!.latestAlert).toBe("2024-01-01T00:10:00.000Z")
  })

  it("detects escalating pattern", () => {
    // 1 alert in first third, 2 in second, 3 in third
    const alerts = [
      makeAlert({ triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:04:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:05:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:08:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:09:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:09:30Z" }),
    ]
    const result = computeAlertTimeline(alerts)
    expect(result!.escalationPattern).toBe("escalating")
  })

  it("detects intermittent pattern (gap in middle)", () => {
    // Alerts only in first and last third
    const alerts = [
      makeAlert({ triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:01:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:09:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:09:30Z" }),
    ]
    const result = computeAlertTimeline(alerts)
    expect(result!.escalationPattern).toBe("intermittent")
  })

  it("returns stable for uniform distribution", () => {
    const alerts = [
      makeAlert({ triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:01:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:03:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:04:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:05:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:06:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:08:00Z" }),
      makeAlert({ triggeredAt: "2024-01-01T00:09:00Z" }),
    ]
    const result = computeAlertTimeline(alerts)
    expect(result!.escalationPattern).toBe("stable")
  })
})

describe("extractServiceTopology", () => {
  it("returns null when no services found", () => {
    expect(extractServiceTopology(null, [])).toBeNull()
    expect(extractServiceTopology(makeIncident(), [makeAlert()])).toBeNull()
  })

  it("uses incident serviceId as primary", () => {
    const incident = makeIncident({ serviceId: "svc-a" })
    const alerts = [
      makeAlert({ serviceId: "svc-a" }),
      makeAlert({ serviceId: "svc-b" }),
    ]
    const result = extractServiceTopology(incident, alerts)
    expect(result!.primaryService).toBe("svc-a")
    expect(result!.relatedServices).toEqual(["svc-b"])
    expect(result!.affectedServiceCount).toBe(2)
  })

  it("picks most frequent service when incident has no serviceId", () => {
    const alerts = [
      makeAlert({ serviceId: "svc-b" }),
      makeAlert({ serviceId: "svc-b" }),
      makeAlert({ serviceId: "svc-a" }),
    ]
    const result = extractServiceTopology(null, alerts)
    expect(result!.primaryService).toBe("svc-b")
    expect(result!.relatedServices).toEqual(["svc-a"])
  })

  it("handles single service", () => {
    const result = extractServiceTopology(null, [
      makeAlert({ serviceId: "svc-x" }),
    ])
    expect(result!.primaryService).toBe("svc-x")
    expect(result!.relatedServices).toEqual([])
    expect(result!.affectedServiceCount).toBe(1)
  })
})

describe("computeSeverityEscalation", () => {
  it("returns null for fewer than 2 alerts", () => {
    expect(computeSeverityEscalation([])).toBeNull()
    expect(computeSeverityEscalation([makeAlert()])).toBeNull()
  })

  it("detects no escalation when severity stays same", () => {
    const alerts = [
      makeAlert({ severity: "medium", triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ severity: "medium", triggeredAt: "2024-01-01T00:01:00Z" }),
    ]
    const result = computeSeverityEscalation(alerts)
    expect(result!.escalated).toBe(false)
    expect(result!.initialSeverity).toBe("medium")
    expect(result!.currentSeverity).toBe("medium")
    expect(result!.escalationTime).toBeUndefined()
  })

  it("detects escalation from low to critical", () => {
    const alerts = [
      makeAlert({ severity: "low", triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ severity: "medium", triggeredAt: "2024-01-01T00:01:00Z" }),
      makeAlert({ severity: "critical", triggeredAt: "2024-01-01T00:02:00Z" }),
    ]
    const result = computeSeverityEscalation(alerts)
    expect(result!.escalated).toBe(true)
    expect(result!.initialSeverity).toBe("low")
    expect(result!.currentSeverity).toBe("critical")
    expect(result!.escalationTime).toBe("2024-01-01T00:02:00Z")
  })

  it("reports first occurrence of peak severity as escalation time", () => {
    const alerts = [
      makeAlert({ severity: "low", triggeredAt: "2024-01-01T00:00:00Z" }),
      makeAlert({ severity: "high", triggeredAt: "2024-01-01T00:01:00Z" }),
      makeAlert({ severity: "high", triggeredAt: "2024-01-01T00:02:00Z" }),
    ]
    const result = computeSeverityEscalation(alerts)
    expect(result!.escalationTime).toBe("2024-01-01T00:01:00Z")
  })
})
