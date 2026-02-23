import { describe, it, expect } from "vitest"
import { formatStateForSupervisor } from "../../agents/supervisor/format.js"
import type { InvestigationState } from "../../types/state.js"
import type { AlertContext, IncidentContext } from "../../types/contexts.js"

function makeIncident(
  overrides: Partial<IncidentContext> = {},
): IncidentContext {
  return {
    incidentId: "inc-1",
    number: 1,
    title: "OOM in service-a",
    severity: "high",
    status: "investigating",
    priority: "p2",
    alertCount: 3,
    triggeredAt: new Date().toISOString(),
    serviceName: "service-a",
    ...overrides,
  }
}

function makeState(
  overrides: Partial<InvestigationState> = {},
): InvestigationState {
  return {
    investigationId: "inv-1",
    incidentId: "inc-1",
    config: {
      llm: { provider: "anthropic", model: "claude-sonnet-4-5-20250514" },
      maxIterations: 8,
    },
    integrations: [],
    phase: "gathering",
    iterations: 1,
    lastProgressSnapshot: null,
    lastAgentResponse: null,
    availableDataSources: [],
    incident: makeIncident(),
    alerts: [] as AlertContext[],
    gatheredData: {},
    needsMoreData: false,
    dataGaps: [],
    skillsLoaded: [],
    errors: [],
    hypotheses: [],
    recommendations: [],
    ...overrides,
  }
}

describe("formatStateForSupervisor", () => {
  it("renders without self-assessment when lastAgentResponse is null", () => {
    const result = formatStateForSupervisor(makeState())
    expect(result).not.toContain("## Previous Agent Assessment")
    expect(result).toContain("## Incident")
    expect(result).toContain("OOM in service-a")
  })

  it("renders self-assessment without data requests", () => {
    const result = formatStateForSupervisor(
      makeState({
        lastAgentResponse: {
          agent: "scout",
          status: "completed",
          summary: "Found 3 alerts for incident",
          recommendation: "analyst",
          reasoning: "Initial data collected",
        },
      }),
    )
    expect(result).toContain("## Previous Agent Assessment")
    expect(result).toContain("Agent: scout")
    expect(result).toContain("Status: completed")
    expect(result).toContain("Found 3 alerts")
    expect(result).not.toContain("### Data Requests")
  })

  it("renders self-assessment with data requests", () => {
    const result = formatStateForSupervisor(
      makeState({
        lastAgentResponse: {
          agent: "analyst",
          status: "needs_more_data",
          summary: "Need external data",
          recommendation: "gatherer",
          dataRequests: [
            {
              source: "logs",
              targets: ["service-a"],
              query: "OutOfMemory",
              priority: "required",
              reasoning: "Need to confirm OOM pattern",
            },
            {
              source: "runbooks",
              targets: ["service-b"],
              priority: "nice_to_have",
              reasoning: "Check remediation runbook",
            },
          ],
          reasoning: "Alert payloads show OOM",
        },
      }),
    )
    expect(result).toContain("### Data Requests")
    expect(result).toContain("[required] logs for service-a")
    expect(result).toContain('query: "OutOfMemory"')
    expect(result).toContain("[nice_to_have] runbooks for service-b")
    expect(result).toContain("Need to confirm OOM pattern")
  })

  it("renders available data sources", () => {
    const result = formatStateForSupervisor(
      makeState({
        availableDataSources: [
          {
            source: "logs",
            provider: "built-in",
            description: "Application logs",
          },
          {
            source: "code",
            provider: "github",
            description: "Code search",
          },
        ],
      }),
    )
    expect(result).toContain("## Available Data Sources")
    expect(result).toContain("logs (built-in): Application logs")
    expect(result).toContain("code (github): Code search")
  })

  it("renders empty data sources message", () => {
    const result = formatStateForSupervisor(
      makeState({ availableDataSources: [] }),
    )
    expect(result).toContain("No external data sources configured")
  })

  it("renders hypotheses with confidence", () => {
    const result = formatStateForSupervisor(
      makeState({
        hypotheses: [
          {
            id: "h1",
            description: "Memory leak in service-a",
            confidence: 0.75,
            evidence: [],
          },
        ],
      }),
    )
    expect(result).toContain("## Hypotheses (1)")
    expect(result).toContain("[75%] Memory leak in service-a")
  })

  it("renders recommendations with priority", () => {
    const result = formatStateForSupervisor(
      makeState({
        recommendations: [
          {
            id: "r1",
            title: "Increase heap size",
            description: "Raise JVM heap to 4GB",
            priority: "high",
            urgency: "immediate",
            steps: [],
          },
        ],
      }),
    )
    expect(result).toContain("## Recommendations (1)")
    expect(result).toContain("[high] Increase heap size")
  })

  it("renders process state with iteration count", () => {
    const result = formatStateForSupervisor(
      makeState({ iterations: 3, phase: "analysis" }),
    )
    expect(result).toContain("Phase: analysis, Iteration: 3/8")
  })

  it("does NOT dump raw gatheredData fields", () => {
    const result = formatStateForSupervisor(
      makeState({
        gatheredData: {
          logs: [{ message: "error log content" }],
          commits: [{ sha: "abc123", message: "fix bug" }],
        },
      }),
    )
    // Should mention counts but not raw content
    expect(result).toContain("logs (1 entries)")
    expect(result).toContain("commits (1 entries)")
    expect(result).not.toContain("error log content")
    expect(result).not.toContain("abc123")
  })

  it("renders incident info even without optional fields", () => {
    const result = formatStateForSupervisor(
      makeState({ incident: null }),
    )
    expect(result).toContain("No incident data available")
  })
})
