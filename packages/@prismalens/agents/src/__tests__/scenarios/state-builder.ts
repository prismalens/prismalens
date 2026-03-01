/**
 * State builder — constructs valid InvestigationState for tests.
 *
 * Provides buildTestState() with sensible defaults and pre-built states
 * at key graph positions (post-scout, post-analyst).
 */

import type { InvestigationState } from "../../types/state.js"
import type { IncidentContext, AlertContext } from "../../types/contexts.js"
import type { GatheredData, AgentSelfAssessment } from "../../types/state.js"
import type { Hypothesis } from "../../types/results.js"

/**
 * Build a valid InvestigationState with sensible defaults.
 * All fields have defaults; pass overrides for specific test scenarios.
 */
export function buildTestState(
  overrides?: Partial<InvestigationState>,
): InvestigationState {
  return {
    investigationId: "inv-test-001",
    incidentId: "inc-test-001",
    config: {
      llm: { provider: "anthropic", model: "test-model" },
      maxIterations: 8,
    },
    integrations: [],
    iterations: 0,
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
    result: undefined,
    ...overrides,
  }
}

/**
 * Build state as it would look after the scout node has run.
 */
export function buildPostScoutState(
  incident: IncidentContext,
  alerts: AlertContext[],
  gatheredData?: Partial<GatheredData>,
): InvestigationState {
  return buildTestState({
    incident,
    alerts,
    gatheredData: {
      logs: [],
      commits: [],
      deployments: [],
      metrics: [],
      codeSearchResults: [],
      changeEvents: [],
      similarIncidents: [],
      ...gatheredData,
    },
    lastAgentResponse: {
      agent: "scout",
      status: "completed",
      summary: `Scout loaded incident "${incident.title}" with ${alerts.length} alerts.`,
      recommendation: "analyst",
      reasoning: "Initial data loaded successfully.",
    },
  })
}

/**
 * Build state as it would look after the analyst node has run.
 */
export function buildPostAnalystState(
  incident: IncidentContext,
  alerts: AlertContext[],
  hypotheses: Hypothesis[],
  assessment: AgentSelfAssessment,
  gatheredData?: Partial<GatheredData>,
): InvestigationState {
  const bestConfidence =
    hypotheses.length > 0
      ? Math.max(...hypotheses.map((h) => h.confidence))
      : 0

  return buildTestState({
    incident,
    alerts,
    hypotheses,
    iterations: 1,
    gatheredData: {
      logs: [],
      commits: [],
      deployments: [],
      metrics: [],
      codeSearchResults: [],
      changeEvents: [],
      similarIncidents: [],
      ...gatheredData,
    },
    lastAgentResponse: assessment,
    needsMoreData: assessment.recommendation === "gatherer",
    dataGaps: assessment.dataRequests?.map((r) => r.reasoning) ?? [],
    lastProgressSnapshot: {
      dataGaps: [],
      sourcesQueried: ["incident", "alerts"],
      hypothesisCount: hypotheses.length,
      bestConfidence: bestConfidence > 0 ? bestConfidence : null,
      recommendationCount: 0,
    },
  })
}

