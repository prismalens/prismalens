import { describe, it, expect, vi } from "vitest"
import { createScoutNode } from "../../agents/scout/index.js"
import type { DataProvider } from "../../providers/data-provider.js"
import type { InvestigationState } from "../../types/state.js"
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

function makeState(overrides: Partial<InvestigationState> = {}): InvestigationState {
  return {
    investigationId: "inv-1",
    incidentId: "inc-1",
    config: { llm: { provider: "anthropic", model: "test" } },
    integrations: [],
    iterations: 0,
    lastProgressSnapshot: null,
    errors: [],
    skillsLoaded: [],
    incident: null,
    alerts: [],
    gatheredData: {},
    needsMoreData: false,
    dataGaps: [],
    hypotheses: [],
    recommendations: [],
    ...overrides,
  }
}

function makeProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    fetchIncident: vi.fn().mockResolvedValue(makeIncident()),
    fetchAlerts: vi.fn().mockResolvedValue({
      alerts: [makeAlert()],
      hasMore: false,
    }),
    fetchSimilarIncidents: vi.fn().mockResolvedValue({ incidents: [] }),
    fetchChangeEvents: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe("createScoutNode", () => {
  it("fetches all sources and returns complete coverage", async () => {
    const provider = makeProvider()
    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    expect(result.incident).toBeDefined()
    expect(result.alerts).toHaveLength(1)
    expect(result.gatheredData?.coverage?.dataCompleteness).toBe("complete")
    expect(result.gatheredData?.coverage?.incident.found).toBe(true)
    expect(result.gatheredData?.coverage?.alerts.sampled).toBe(false)
    expect(result.errors).toEqual([])
  })

  it("samples alerts when count exceeds limit", async () => {
    // Create 60 alerts: 5 critical, 5 high, 50 medium
    const alerts: AlertContext[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeAlert({ alertId: `c${i}`, severity: "critical" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeAlert({ alertId: `h${i}`, severity: "high" }),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        makeAlert({ alertId: `m${i}`, severity: "medium" }),
      ),
    ]

    const provider = makeProvider({
      fetchAlerts: vi.fn().mockResolvedValue({
        alerts,
        hasMore: true,
      }),
    })

    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    expect(result.alerts!.length).toBe(50)
    // All critical and high should be included
    const severities = result.alerts!.map((a) => a.severity)
    expect(severities.filter((s) => s === "critical")).toHaveLength(5)
    expect(severities.filter((s) => s === "high")).toHaveLength(5)
    // alertsTotal is null because hasMore=true
    expect(result.gatheredData?.coverage?.alerts.total).toBeNull()
  })

  it("handles fetch failure gracefully", async () => {
    const provider = makeProvider({
      fetchAlerts: vi.fn().mockRejectedValue(new Error("DB timeout")),
    })

    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    // Should still have incident data
    expect(result.incident).toBeDefined()
    // Alerts should be empty fallback
    expect(result.alerts).toEqual([])
    // Error should be accumulated
    expect(result.errors).toHaveLength(1)
    expect(result.errors![0]).toContain("fetchAlerts")
    expect(result.errors![0]).toContain("DB timeout")
    // Coverage should be partial
    expect(result.gatheredData?.coverage?.dataCompleteness).toBe("partial")
  })

  it("early exits when incident not found", async () => {
    const provider = makeProvider({
      fetchIncident: vi.fn().mockResolvedValue(null),
    })

    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    expect(result.errors).toHaveLength(1)
    expect(result.errors![0]).toContain("Incident not found")
    // Should not have gatheredData
    expect(result.gatheredData).toBeUndefined()
  })

  it("handles missing optional DataProvider methods", async () => {
    // Provider without fetchChangeEvents and fetchSimilarIncidents
    const provider: DataProvider = {
      fetchIncident: vi.fn().mockResolvedValue(makeIncident()),
      fetchAlerts: vi.fn().mockResolvedValue({
        alerts: [makeAlert()],
        hasMore: false,
      }),
    }

    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    expect(result.incident).toBeDefined()
    expect(result.alerts).toHaveLength(1)
    expect(result.gatheredData?.coverage?.changeEvents).toBeNull()
    expect(result.gatheredData?.coverage?.similarIncidents).toBeNull()
    // Still partial because optional sources not queried
    expect(result.gatheredData?.coverage?.dataCompleteness).toBe("partial")
  })

  it("populates changeEvents and similarIncidents in gatheredData", async () => {
    const changeEvents = [
      {
        id: "ce1",
        type: "deployment" as const,
        source: "github",
        description: "Deploy v1.2.3",
        timestamp: new Date().toISOString(),
        serviceId: "svc-a",
        metadata: null,
        riskScore: null,
      },
    ]
    const similarIncidents = [
      {
        incidentId: "inc-old",
        title: "Similar incident",
        similarity: 0.8,
      },
    ]

    const provider = makeProvider({
      fetchChangeEvents: vi.fn().mockResolvedValue(changeEvents),
      fetchSimilarIncidents: vi.fn().mockResolvedValue({
        incidents: similarIncidents,
      }),
    })

    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    expect(result.gatheredData?.changeEvents).toEqual(changeEvents)
    expect(result.gatheredData?.similarIncidents).toEqual(similarIncidents)
  })

  it("computes enrichments from fetched data", async () => {
    const alerts = [
      makeAlert({
        alertId: "a1",
        severity: "low",
        serviceId: "svc-a",
        triggeredAt: "2024-01-01T00:00:00Z",
      }),
      makeAlert({
        alertId: "a2",
        severity: "high",
        serviceId: "svc-b",
        triggeredAt: "2024-01-01T00:05:00Z",
      }),
    ]

    const provider = makeProvider({
      fetchIncident: vi.fn().mockResolvedValue(
        makeIncident({ serviceId: "svc-a" }),
      ),
      fetchAlerts: vi.fn().mockResolvedValue({
        alerts,
        hasMore: false,
      }),
    })

    const scout = createScoutNode(provider)
    const result = await scout(makeState())

    // Coverage should have services detected
    expect(result.gatheredData?.coverage?.services.detected).toContain("svc-a")
    expect(result.gatheredData?.coverage?.services.detected).toContain("svc-b")
    expect(result.gatheredData?.coverage?.services.count).toBe(2)
    // Should have temporal overlap (timeline computed)
    expect(result.gatheredData?.coverage?.temporalOverlap).toBe(true)
  })
})
