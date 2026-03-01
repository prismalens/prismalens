/**
 * Analyst node scenarios — 4 scenarios testing extractAnalystResults().
 *
 * Tests prompt construction, structured output extraction, state updates,
 * and routing logic per the analyst's confidence thresholds.
 */

import { makeTimeline } from "../timeline.js"
import { buildPostScoutState } from "../state-builder.js"
import type { NodeScenario, AnalystExpectation } from "./types.js"

const t = makeTimeline()

// --- Scenario 1: High-confidence NPE ---
const highConfidenceNpe: NodeScenario<AnalystExpectation> = {
  id: "analyst-high-confidence-npe",
  name: "High-confidence NPE analysis",
  description:
    "Analyst receives NPE incident with error alerts and Render logs in gatheredData. " +
    "Mock returns 2 hypotheses (NPE=0.85, config=0.3), no dataGaps.",
  tags: ["analyst", "high-confidence", "npe"],
  inputState: buildPostScoutState(
    {
      incidentId: "inc-npe-001",
      number: 42,
      title: "NullPointerException in UserService causing 500 errors",
      severity: "high",
      status: "investigating",
      priority: "p2",
      alertCount: 3,
      triggeredAt: t.minus({ minutes: 30 }),
    },
    [
      {
        alertId: "alert-1",
        title: "NullPointerException in UserService.getProfile",
        severity: "high",
        status: "triggered",
        triggeredAt: t.minus({ minutes: 30 }),
      },
    ],
    {
      logs: [
        "ERROR java.lang.NullPointerException at UserService.getProfile(UserService.java:45)",
      ],
    },
  ),
  expectation: {
    minHypotheses: 2,
    hypothesisKeywords: ["null"],
    recommendation: "resolver",
    needsMoreData: false,
    category: "code_bug",
  },
}

// --- Scenario 2: Low-confidence with gaps ---
const lowConfidenceWithGaps: NodeScenario<AnalystExpectation> = {
  id: "analyst-low-confidence-gaps",
  name: "Low-confidence analysis with data gaps",
  description:
    "Analyst receives vague 'service degraded' incident with minimal alerts. " +
    "Mock returns 1 hypothesis (0.3), dataGaps: ['metrics', 'logs'].",
  tags: ["analyst", "low-confidence", "data-gaps"],
  inputState: buildPostScoutState(
    {
      incidentId: "inc-vague-001",
      number: 55,
      title: "Service degraded — slow responses",
      severity: "medium",
      status: "investigating",
      priority: "p3",
      alertCount: 1,
      triggeredAt: t.minus({ minutes: 15 }),
    },
    [
      {
        alertId: "alert-vague-1",
        title: "Response time elevated",
        severity: "medium",
        status: "triggered",
        triggeredAt: t.minus({ minutes: 15 }),
      },
    ],
  ),
  expectation: {
    minHypotheses: 1,
    hypothesisKeywords: [],
    recommendation: "gatherer",
    needsMoreData: true,
  },
}

// --- Scenario 3: Medium-confidence no gaps ---
const mediumConfidenceNoGaps: NodeScenario<AnalystExpectation> = {
  id: "analyst-medium-confidence",
  name: "Medium-confidence analysis without data gaps",
  description:
    "Analyst receives memory warning incident with some metrics. " +
    "Mock returns 2 hypotheses (0.55 and 0.4), no dataGaps.",
  tags: ["analyst", "medium-confidence"],
  inputState: buildPostScoutState(
    {
      incidentId: "inc-mem-001",
      number: 78,
      title: "Memory usage warning on user-service",
      severity: "medium",
      status: "investigating",
      priority: "p3",
      alertCount: 2,
      triggeredAt: t.minus({ hours: 2 }),
    },
    [
      {
        alertId: "alert-mem-1",
        title: "Memory usage at 80%",
        severity: "medium",
        status: "triggered",
        triggeredAt: t.minus({ hours: 2 }),
      },
      {
        alertId: "alert-mem-2",
        title: "GC pressure increasing",
        severity: "low",
        status: "triggered",
        triggeredAt: t.minus({ hours: 1 }),
      },
    ],
    {
      metrics: [{ heapUsage: "80%", gcPressure: "elevated" }],
    },
  ),
  expectation: {
    minHypotheses: 2,
    hypothesisKeywords: [],
    recommendation: "resolver",
    needsMoreData: false,
  },
}

// --- Scenario 4: Analyst error handling ---
const analystError: NodeScenario<AnalystExpectation> = {
  id: "analyst-error-handling",
  name: "Analyst error handling",
  description:
    "createDeepAgent throws an error. Analyst should return error in state " +
    "with blocked status and recommendation to gatherer.",
  tags: ["analyst", "error-handling"],
  inputState: buildPostScoutState(
    {
      incidentId: "inc-err-001",
      number: 99,
      title: "Test incident for error handling",
      severity: "medium",
      status: "investigating",
      priority: "p3",
      alertCount: 1,
      triggeredAt: t.minus({ minutes: 5 }),
    },
    [
      {
        alertId: "alert-err-1",
        title: "Test alert",
        severity: "medium",
        status: "triggered",
        triggeredAt: t.minus({ minutes: 5 }),
      },
    ],
  ),
  expectation: {
    minHypotheses: 0,
    hypothesisKeywords: [],
    recommendation: "gatherer",
    needsMoreData: false,
  },
}

export const ANALYST_SCENARIOS = [
  highConfidenceNpe,
  lowConfidenceWithGaps,
  mediumConfidenceNoGaps,
  analystError,
]
