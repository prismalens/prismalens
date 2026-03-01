/**
 * Supervisor node scenarios — 5 scenarios testing routing decisions.
 *
 * The last 2 scenarios (iteration budget, stall detection) exercise
 * safety guards without needing LLM mocks.
 */

import { makeTimeline } from "../timeline.js"
import { buildTestState } from "../state-builder.js"
import type { NodeScenario, SupervisorExpectation } from "./types.js"

const t = makeTimeline()

// --- Scenario 1: Route to gatherer ---
const routeToGatherer: NodeScenario<SupervisorExpectation> = {
  id: "supervisor-route-gatherer",
  name: "Route to gatherer when analyst needs data",
  description:
    "Analyst says needs_more_data at iteration 1. LLM should decide gatherer.",
  tags: ["supervisor", "routing", "gatherer"],
  inputState: {
    ...buildTestState({
      investigationId: "inv-sup-1",
      iterations: 1,
      incident: {
        incidentId: "inc-1",
        number: 1,
        title: "Test incident",
        severity: "medium",
        status: "investigating",
        priority: "p3",
        alertCount: 1,
        triggeredAt: t.minus({ minutes: 10 }),
      },
      lastAgentResponse: {
        agent: "analyst",
        status: "needs_more_data",
        summary: "Need more logs to confirm",
        recommendation: "gatherer",
        reasoning: "Insufficient data",
      },
      lastProgressSnapshot: null,
    }),
  },
  expectation: {
    routeTo: "gatherer",
  },
}

// --- Scenario 2: Route to resolver ---
const routeToResolver: NodeScenario<SupervisorExpectation> = {
  id: "supervisor-route-resolver",
  name: "Route to resolver when analyst has high confidence",
  description:
    "Analyst completed with high confidence at iteration 2. LLM should decide resolver.",
  tags: ["supervisor", "routing", "resolver"],
  inputState: {
    ...buildTestState({
      investigationId: "inv-sup-2",
      iterations: 2,
      incident: {
        incidentId: "inc-2",
        number: 2,
        title: "High confidence incident",
        severity: "high",
        status: "investigating",
        priority: "p2",
        alertCount: 3,
        triggeredAt: t.minus({ minutes: 30 }),
      },
      hypotheses: [
        {
          id: "h-1",
          description: "Root cause identified",
          confidence: 0.85,
          evidence: [],
        },
      ],
      lastAgentResponse: {
        agent: "analyst",
        status: "completed",
        summary: "Root cause identified with high confidence",
        recommendation: "resolver",
        reasoning: "High confidence analysis complete",
      },
      lastProgressSnapshot: {
        dataGaps: [],
        sourcesQueried: ["incident", "alerts"],
        hypothesisCount: 0,
        bestConfidence: null,
        recommendationCount: 0,
      },
    }),
  },
  expectation: {
    routeTo: "resolver",
  },
}

// --- Scenario 3: Route to __end__ ---
const routeToEnd: NodeScenario<SupervisorExpectation> = {
  id: "supervisor-route-end",
  name: "Route to __end__ when resolver completes",
  description:
    "Resolver completed at iteration 3. LLM should decide __end__.",
  tags: ["supervisor", "routing", "end"],
  inputState: {
    ...buildTestState({
      investigationId: "inv-sup-3",
      iterations: 3,
      incident: {
        incidentId: "inc-3",
        number: 3,
        title: "Resolved incident",
        severity: "high",
        status: "investigating",
        priority: "p2",
        alertCount: 2,
        triggeredAt: t.minus({ hours: 1 }),
      },
      hypotheses: [
        {
          id: "h-1",
          description: "Root cause confirmed",
          confidence: 0.9,
          evidence: [],
          category: "code_bug",
        },
      ],
      recommendations: [
        {
          id: "r-1",
          title: "Apply fix",
          description: "Fix the bug",
          urgency: "immediate",
          priority: "high",
        },
      ],
      lastAgentResponse: {
        agent: "resolver",
        status: "completed",
        summary: "Recommendations produced",
        recommendation: "__end__",
        reasoning: "Resolution complete",
      },
      lastProgressSnapshot: {
        dataGaps: [],
        sourcesQueried: ["incident", "alerts"],
        hypothesisCount: 1,
        bestConfidence: 0.9,
        recommendationCount: 0,
      },
    }),
  },
  expectation: {
    routeTo: "__end__",
    hasResult: true,
  },
}

// --- Scenario 4: Iteration budget (safety guard, no LLM needed) ---
const iterationBudget: NodeScenario<SupervisorExpectation> = {
  id: "supervisor-iteration-budget",
  name: "Iteration budget prevents infinite loops",
  description:
    "iterations >= maxIterations. Guard fires before LLM call.",
  tags: ["supervisor", "safety", "budget"],
  inputState: {
    ...buildTestState({
      investigationId: "inv-sup-4",
      iterations: 8, // equals maxIterations default
      config: {
        llm: { provider: "anthropic", model: "test-model" },
        maxIterations: 8,
      },
      incident: {
        incidentId: "inc-4",
        number: 4,
        title: "Budget test incident",
        severity: "medium",
        status: "investigating",
        priority: "p3",
        alertCount: 1,
        triggeredAt: t.minus({ minutes: 5 }),
      },
    }),
  },
  expectation: {
    routeTo: "__end__",
    hasResult: true,
  },
}

// --- Scenario 5: Stall detection (safety guard, no LLM needed) ---
const stallDetection: NodeScenario<SupervisorExpectation> = {
  id: "supervisor-stall-detection",
  name: "Stall detection terminates stuck investigation",
  description:
    "Same dataGaps and sourcesQueried as last snapshot, no new hypotheses. " +
    "Guard fires before LLM call.",
  tags: ["supervisor", "safety", "stall"],
  inputState: {
    ...buildTestState({
      investigationId: "inv-sup-5",
      iterations: 3,
      incident: {
        incidentId: "inc-5",
        number: 5,
        title: "Stalled investigation",
        severity: "medium",
        status: "investigating",
        priority: "p3",
        alertCount: 1,
        triggeredAt: t.minus({ minutes: 30 }),
      },
      dataGaps: ["metrics"],
      lastProgressSnapshot: {
        dataGaps: ["metrics"],
        sourcesQueried: ["incident", "alerts"],
        hypothesisCount: 0,
        bestConfidence: null,
        recommendationCount: 0,
      },
      gatheredData: {
        coverage: {
          incident: { found: true },
          alerts: { fetched: 1, total: 1, sampled: false },
          changeEvents: null,
          similarIncidents: null,
          services: { detected: [], count: 0 },
          dataCompleteness: "partial",
          dataGaps: ["metrics"],
          temporalOverlap: false,
        },
      },
    }),
  },
  expectation: {
    routeTo: "__end__",
    hasResult: true,
  },
}

export const SUPERVISOR_SCENARIOS = [
  routeToGatherer,
  routeToResolver,
  routeToEnd,
  iterationBudget,
  stallDetection,
]
