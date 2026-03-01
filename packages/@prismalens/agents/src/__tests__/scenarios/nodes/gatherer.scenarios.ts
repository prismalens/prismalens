/**
 * Gatherer node scenarios — 3 scenarios testing gatherer output processing.
 */

import { makeTimeline } from "../timeline.js"
import { buildPostAnalystState } from "../state-builder.js"
import type { NodeScenario, GathererExpectation } from "./types.js"

const t = makeTimeline()

const baseIncident = {
  incidentId: "inc-gather-001",
  number: 50,
  title: "Service errors requiring data gathering",
  severity: "high" as const,
  status: "investigating" as const,
  priority: "p2" as const,
  alertCount: 2,
  triggeredAt: t.minus({ minutes: 30 }),
}

const baseAlerts = [
  {
    alertId: "alert-g-1",
    title: "Error rate spike",
    severity: "high" as const,
    status: "triggered" as const,
    triggeredAt: t.minus({ minutes: 30 }),
  },
]

// --- Scenario 1: Successful data collection ---
const successfulCollection: NodeScenario<GathererExpectation> = {
  id: "gatherer-successful-collection",
  name: "Successful data collection",
  description:
    "Gatherer receives post-analyst state with data requests for Render logs + GitHub commits. " +
    "Mock returns successful structured response with sufficient coverage.",
  tags: ["gatherer", "success"],
  inputState: buildPostAnalystState(
    baseIncident,
    baseAlerts,
    [
      {
        id: "h-1",
        description: "Possible code bug in service",
        confidence: 0.6,
        evidence: [],
      },
    ],
    {
      agent: "analyst",
      status: "needs_more_data",
      summary: "Need more data to confirm hypothesis",
      recommendation: "gatherer",
      dataRequests: [
        {
          source: "logs",
          query: "error logs from service",
          priority: "required",
          reasoning: "Need error logs to confirm hypothesis",
        },
        {
          source: "commits",
          targets: ["example/repo"],
          priority: "nice_to_have",
          reasoning: "Recent commits might show the change",
        },
      ],
      reasoning: "Low confidence, need more data",
    },
  ),
  expectation: {
    status: "completed",
    recommendation: "analyst",
    hasSummary: true,
  },
}

// --- Scenario 2: Partial data with gaps ---
const partialDataWithGaps: NodeScenario<GathererExpectation> = {
  id: "gatherer-partial-data",
  name: "Partial data with gaps",
  description:
    "Gatherer gets some data but Prometheus is unreachable. " +
    "Mock returns partial coverage assessment.",
  tags: ["gatherer", "partial"],
  inputState: buildPostAnalystState(
    baseIncident,
    baseAlerts,
    [
      {
        id: "h-2",
        description: "Possible infrastructure issue",
        confidence: 0.4,
        evidence: [],
      },
    ],
    {
      agent: "analyst",
      status: "needs_more_data",
      summary: "Need metrics data",
      recommendation: "gatherer",
      dataRequests: [
        {
          source: "metrics",
          query: "CPU and memory metrics",
          priority: "required",
          reasoning: "Metrics would confirm infrastructure hypothesis",
        },
      ],
      reasoning: "Need metrics to confirm",
    },
  ),
  expectation: {
    status: "needs_more_data",
    recommendation: "analyst",
    hasSummary: true,
  },
}

// --- Scenario 3: Gatherer error handling ---
const gathererError: NodeScenario<GathererExpectation> = {
  id: "gatherer-error-handling",
  name: "Gatherer error handling",
  description:
    "createDeepAgent throws an error. Gatherer should return error " +
    "with blocked status and recommendation to analyst.",
  tags: ["gatherer", "error-handling"],
  inputState: buildPostAnalystState(
    baseIncident,
    baseAlerts,
    [],
    {
      agent: "analyst",
      status: "needs_more_data",
      summary: "Need data",
      recommendation: "gatherer",
      reasoning: "No data available",
    },
  ),
  expectation: {
    status: "blocked",
    recommendation: "analyst",
    hasSummary: true,
  },
}

export const GATHERER_SCENARIOS = [
  successfulCollection,
  partialDataWithGaps,
  gathererError,
]
