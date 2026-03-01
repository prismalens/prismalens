/**
 * Resolver node scenarios — 3 scenarios testing extractResolverResults().
 */

import { makeTimeline } from "../timeline.js"
import { buildPostAnalystState } from "../state-builder.js"
import type { NodeScenario, ResolverExpectation } from "./types.js"

const t = makeTimeline()

const baseIncident = {
  incidentId: "inc-resolve-001",
  number: 60,
  title: "Service issue requiring remediation",
  severity: "high" as const,
  status: "investigating" as const,
  priority: "p2" as const,
  alertCount: 2,
  triggeredAt: t.minus({ minutes: 30 }),
}

const baseAlerts = [
  {
    alertId: "alert-r-1",
    title: "Error requiring fix",
    severity: "high" as const,
    status: "triggered" as const,
    triggeredAt: t.minus({ minutes: 30 }),
  },
]

// --- Scenario 1: Clear remediation ---
const clearRemediation: NodeScenario<ResolverExpectation> = {
  id: "resolver-clear-remediation",
  name: "Clear remediation path",
  description:
    "Resolver receives high-confidence NPE hypothesis with similar incident " +
    "that has a known fix. Mock returns clear recommendation.",
  tags: ["resolver", "clear-fix"],
  inputState: buildPostAnalystState(
    baseIncident,
    baseAlerts,
    [
      {
        id: "h-1",
        description: "NullPointerException due to removed null check",
        confidence: 0.85,
        evidence: [
          {
            type: "log",
            description: "Stack trace shows NPE at UserService.java:45",
            source: "render-logs",
          },
        ],
        category: "code_bug",
      },
    ],
    {
      agent: "analyst",
      status: "completed",
      summary: "High confidence NPE root cause identified",
      recommendation: "resolver",
      reasoning: "High confidence, ready for resolution",
    },
    {
      similarIncidents: [
        {
          incidentId: "inc-past-001",
          title: "NPE in PaymentService after null check removal",
          similarity: 0.9,
          rootCause: "Null check was removed during optimization",
          resolution: "Restored null check and added unit test",
        },
      ],
    },
  ),
  expectation: {
    minRecommendations: 1,
    recommendationKeywords: ["null check"],
    recommendation: "__end__",
    hasRootCause: true,
  },
}

// --- Scenario 2: Multiple recommendations ---
const multipleRecommendations: NodeScenario<ResolverExpectation> = {
  id: "resolver-multiple-recommendations",
  name: "Multiple recommendations for config issue",
  description:
    "Resolver receives config issue hypothesis with 2 possible fixes. " +
    "Mock returns multiple recommendations.",
  tags: ["resolver", "multiple-fixes"],
  inputState: buildPostAnalystState(
    {
      ...baseIncident,
      title: "Database pool exhaustion",
    },
    baseAlerts,
    [
      {
        id: "h-2",
        description: "DB pool size reduced from 100 to 10",
        confidence: 0.7,
        evidence: [],
        category: "config_change",
      },
    ],
    {
      agent: "analyst",
      status: "completed",
      summary: "Config change identified as root cause",
      recommendation: "resolver",
      reasoning: "Config change correlated with incident",
    },
  ),
  expectation: {
    minRecommendations: 1,
    recommendationKeywords: [],
    recommendation: "__end__",
  },
}

// --- Scenario 3: Insufficient context ---
const insufficientContext: NodeScenario<ResolverExpectation> = {
  id: "resolver-insufficient-context",
  name: "Insufficient context for recommendations",
  description:
    "Resolver receives low-confidence hypothesis with no gathered data. " +
    "Mock returns empty recommendations.",
  tags: ["resolver", "insufficient"],
  inputState: buildPostAnalystState(
    baseIncident,
    baseAlerts,
    [
      {
        id: "h-3",
        description: "Unknown issue",
        confidence: 0.2,
        evidence: [],
        category: "unknown",
      },
    ],
    {
      agent: "analyst",
      status: "completed",
      summary: "Low confidence analysis",
      recommendation: "resolver",
      reasoning: "Best-effort with limited data",
    },
  ),
  expectation: {
    minRecommendations: 0,
    recommendationKeywords: [],
    recommendation: "analyst",
  },
}

export const RESOLVER_SCENARIOS = [
  clearRemediation,
  multipleRecommendations,
  insufficientContext,
]
