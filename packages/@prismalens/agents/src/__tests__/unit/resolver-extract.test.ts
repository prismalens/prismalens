import { describe, it, expect } from "vitest"
import { extractResolverResults } from "../../agents/resolver/extract.js"
import type { InvestigationState } from "../../types/state.js"
import type { ResolverOutput } from "../../tools/schemas.js"

function makeState(
  overrides?: Partial<InvestigationState>,
): InvestigationState {
  return {
    investigationId: "inv-1",
    incidentId: "inc-1",
    config: {
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    },
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
    hypotheses: [
      {
        id: "h-1",
        description: "Deployment broke API",
        confidence: 0.7,
        evidence: [],
        category: "deployment",
      },
      {
        id: "h-2",
        description: "Config change caused timeout",
        confidence: 0.4,
        evidence: [],
        category: "config_change",
      },
    ],
    recommendations: [],
    ...overrides,
  }
}

function makeAgentResult(output: ResolverOutput) {
  return { messages: [], structuredResponse: output }
}

describe("extractResolverResults", () => {
  it("maps recommendations with DB-aligned fields", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Rollback deployment v2.3.1",
            description: "Roll back to last known good version",
            category: "rollback",
            priority: "critical",
            urgency: "immediate",
            steps: ["Trigger rollback in CD pipeline", "Verify health checks"],
            estimatedEffort: "minutes",
            precedentBased: true,
            riskLevel: "medium",
            blastRadius: "API service only",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Rollback recommended",
        approachAssessment: "High confidence fix",
      }),
      makeState(),
    )

    const rec = result.recommendations![0]
    expect(rec.title).toBe("Rollback deployment v2.3.1")
    expect(rec.category).toBe("rollback")
    expect(rec.priority).toBe("critical")
    expect(rec.urgency).toBe("immediate")
    expect(rec.estimatedEffort).toBe("minutes")
    expect(rec.steps).toHaveLength(2)
    expect(rec.id).toBeDefined()
  })

  it("tags historical recommendations correctly", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Fix based on precedent",
            description: "Same fix as INC-42",
            category: "code_fix",
            priority: "high",
            urgency: "immediate",
            steps: ["Apply patch"],
            estimatedEffort: "hours",
            precedentBased: true,
            riskLevel: "low",
            blastRadius: "None",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Precedent-based fix",
        approachAssessment: "Proven approach",
      }),
      makeState(),
    )

    expect(result.recommendations![0].tags).toContain("historical")
    expect(result.recommendations![0].tags).not.toContain("novel")
  })

  it("tags novel recommendations correctly", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "New monitoring setup",
            description: "Add alerting for this failure mode",
            category: "monitoring",
            priority: "medium",
            urgency: "short_term",
            steps: ["Create dashboard", "Add alert rule"],
            estimatedEffort: "hours",
            precedentBased: false,
            riskLevel: "low",
            blastRadius: "None",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Add monitoring",
        approachAssessment: "Novel approach",
      }),
      makeState(),
    )

    expect(result.recommendations![0].tags).toContain("novel")
    expect(result.recommendations![0].tags).not.toContain("historical")
  })

  it("includes risk tags", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Drop and recreate index",
            description: "Risky DB operation",
            category: "code_fix",
            priority: "high",
            urgency: "immediate",
            steps: ["Drop index", "Recreate"],
            estimatedEffort: "minutes",
            precedentBased: false,
            riskLevel: "critical",
            blastRadius: "All read queries",
            reversibility: "irreversible",
          },
        ],
        summary: "DB fix",
        approachAssessment: "High risk",
      }),
      makeState(),
    )

    expect(result.recommendations![0].tags).toContain("risk:critical")
    expect(result.recommendations![0].tags).toContain(
      "reversibility:irreversible",
    )
  })

  it("links relatedHypothesisId by category match", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Rollback",
            description: "Roll back deployment",
            category: "rollback",
            priority: "critical",
            urgency: "immediate",
            steps: ["Rollback"],
            estimatedEffort: "minutes",
            precedentBased: false,
            riskLevel: "low",
            blastRadius: "None",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Rollback",
        approachAssessment: "Quick fix",
      }),
      makeState(),
    )

    // rollback maps to "deployment" category → h-1
    expect(result.recommendations![0].relatedHypothesisId).toBe("h-1")
  })

  it("falls back to highest-confidence hypothesis when no category match", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Add monitoring",
            description: "Monitor this failure mode",
            category: "monitoring",
            priority: "low",
            urgency: "long_term",
            steps: ["Add dashboard"],
            estimatedEffort: "hours",
            precedentBased: false,
            riskLevel: "low",
            blastRadius: "None",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Monitoring",
        approachAssessment: "Preventative",
      }),
      makeState({
        hypotheses: [
          {
            id: "h-only",
            description: "Some bug",
            confidence: 0.6,
            evidence: [],
            category: "code_bug",
          },
        ],
      }),
    )

    // monitoring maps to "infrastructure" → no match → falls back to h-only
    expect(result.recommendations![0].relatedHypothesisId).toBe("h-only")
  })

  it("routes to __end__ when recommendations produced", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Fix",
            description: "Apply fix",
            category: "code_fix",
            priority: "high",
            urgency: "immediate",
            steps: ["Fix it"],
            estimatedEffort: "minutes",
            precedentBased: false,
            riskLevel: "low",
            blastRadius: "None",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Fix applied",
        approachAssessment: "Straightforward",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("__end__")
    expect(result.lastAgentResponse?.status).toBe("completed")
  })

  it("routes to analyst when no recommendations produced", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [],
        summary: "Could not determine fix",
        approachAssessment: "Insufficient data",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("analyst")
    expect(result.lastAgentResponse?.status).toBe("insufficient_context")
  })

  it("handles undefined structuredResponse", () => {
    const result = extractResolverResults(
      { messages: [], structuredResponse: undefined },
      makeState(),
    )

    expect(result.lastAgentResponse?.recommendation).toBe("analyst")
    expect(result.lastAgentResponse?.status).toBe("insufficient_context")
  })

  it("includes high-risk count in assessment reasoning", () => {
    const result = extractResolverResults(
      makeAgentResult({
        recommendations: [
          {
            title: "Risky fix",
            description: "Dangerous operation",
            category: "code_fix",
            priority: "critical",
            urgency: "immediate",
            steps: ["Do it"],
            estimatedEffort: "minutes",
            precedentBased: false,
            riskLevel: "high",
            blastRadius: "Everything",
            reversibility: "irreversible",
          },
        ],
        summary: "Risky approach",
        approachAssessment: "Proceed with caution",
      }),
      makeState(),
    )

    expect(result.lastAgentResponse?.reasoning).toContain(
      "1 high-risk recommendation",
    )
  })
})
