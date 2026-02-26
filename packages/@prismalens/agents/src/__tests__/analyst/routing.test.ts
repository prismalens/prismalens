import { describe, it, expect } from "vitest"
import { extractAnalystResults } from "../../agents/analyst/extract.js"
import type { InvestigationState } from "../../types/state.js"
import type { AnalystOutput } from "../../tools/schemas.js"

function makeState(overrides?: Partial<InvestigationState>): InvestigationState {
  return {
    investigationId: "inv-1",
    incidentId: "inc-1",
    config: { llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
    integrations: [],
    iterations: 1,
    lastProgressSnapshot: null,
    errors: [],
    skillsLoaded: [],
    lastAgentResponse: null,
    availableDataSources: [],
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

function makeAgentResult(output: AnalystOutput) {
  return { messages: [], structuredResponse: output }
}

describe("extractAnalystResults routing", () => {
  it("recommends gatherer when no hypotheses are produced", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [],
        dataGaps: ["need more logs"],
        analysisSummary: "Insufficient data",
        confidenceAssessment: "Cannot determine root cause",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("gatherer")
    expect(result.lastAgentResponse?.status).toBe("needs_more_data")
    expect(result.needsMoreData).toBe(true)
  })

  it("recommends resolver for high confidence hypothesis", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [
          {
            description: "Deployment broke API",
            category: "deployment",
            confidence: 0.8,
            evidence: [
              {
                description: "Deploy 5 min before incident",
                direction: "supporting",
                strength: "strong",
                verified: false,
                source: "change events",
              },
              {
                description: "Error rate spiked after deploy",
                direction: "supporting",
                strength: "strong",
                verified: false,
                source: "logs",
              },
            ],
            contradictions: [],
            reasoning: "Strong temporal correlation",
          },
        ],
        dataGaps: [],
        analysisSummary: "Deployment likely root cause",
        confidenceAssessment: "Moderate-high confidence",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("resolver")
    expect(result.lastAgentResponse?.status).toBe("completed")
    expect(result.needsMoreData).toBe(false)
  })

  it("recommends gatherer for low confidence with data gaps", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [
          {
            description: "Possible config change",
            category: "config_change",
            confidence: 0.2,
            evidence: [
              {
                description: "Config file modified",
                direction: "supporting",
                strength: "weak",
                verified: false,
                source: "commits",
              },
            ],
            contradictions: ["No error logs found matching config issue"],
            reasoning: "Weak evidence",
          },
        ],
        dataGaps: ["application logs", "deployment history"],
        analysisSummary: "Need more data",
        confidenceAssessment: "Low confidence",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("gatherer")
    expect(result.lastAgentResponse?.status).toBe("needs_more_data")
    expect(result.needsMoreData).toBe(true)
    expect(result.lastAgentResponse?.dataRequests).toHaveLength(2)
  })

  it("recommends resolver for low confidence without data gaps", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [
          {
            description: "Unknown cause",
            category: "unknown",
            confidence: 0.2,
            evidence: [],
            contradictions: [],
            reasoning: "No clear evidence",
          },
        ],
        dataGaps: [],
        analysisSummary: "Best-effort analysis",
        confidenceAssessment: "Low confidence but no more data available",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("resolver")
    expect(result.needsMoreData).toBe(false)
  })

  it("recommends resolver for medium confidence", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [
          {
            description: "Dependency timeout",
            category: "dependency",
            confidence: 0.5,
            evidence: [
              {
                description: "Timeout errors in logs",
                direction: "supporting",
                strength: "moderate",
                verified: false,
                source: "logs",
              },
            ],
            contradictions: [],
            reasoning: "Moderate evidence",
          },
        ],
        dataGaps: ["upstream service metrics"],
        analysisSummary: "Likely dependency issue",
        confidenceAssessment: "Moderate confidence",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("resolver")
    expect(result.lastAgentResponse?.status).toBe("completed")
  })

  it("sorts hypotheses by adjusted confidence descending", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [
          {
            description: "Low confidence",
            category: "unknown",
            confidence: 0.2,
            evidence: [],
            contradictions: [],
            reasoning: "Weak",
          },
          {
            description: "High confidence",
            category: "deployment",
            confidence: 0.6,
            evidence: [
              {
                description: "Deploy before incident",
                direction: "supporting",
                strength: "strong",
                verified: false,
                source: "change events",
              },
            ],
            contradictions: [],
            reasoning: "Strong",
          },
        ],
        dataGaps: [],
        analysisSummary: "Two hypotheses",
        confidenceAssessment: "Mixed",
      }),
      makeState(),
    )

    const hypotheses = result.hypotheses!
    expect(hypotheses.length).toBe(2)
    expect(hypotheses[0].confidence).toBeGreaterThan(hypotheses[1].confidence)
    expect(hypotheses[0].description).toBe("High confidence")
  })

  it("populates dataGaps from analyst output", () => {
    const result = extractAnalystResults(
      makeAgentResult({
        hypotheses: [
          {
            description: "Hypothesis",
            category: "infrastructure",
            confidence: 0.3,
            evidence: [],
            contradictions: [],
            reasoning: "Need data",
          },
        ],
        dataGaps: ["CPU metrics", "deployment logs"],
        analysisSummary: "Incomplete",
        confidenceAssessment: "Low",
      }),
      makeState(),
    )

    expect(result.dataGaps).toEqual(["CPU metrics", "deployment logs"])
  })

  it("handles undefined structuredResponse gracefully", () => {
    const result = extractAnalystResults(
      { messages: [], structuredResponse: undefined },
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("gatherer")
    expect(result.lastAgentResponse?.status).toBe("needs_more_data")
  })
})
