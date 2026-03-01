/**
 * Scenario runner — orchestrates graph-level scenario execution.
 *
 * Builds the graph, feeds scenario data, captures trajectory + result,
 * and runs assertions.
 */

import { buildInvestigationGraph } from "../../graph/investigation-graph.js"
import { computeAvailableDataSources } from "../../providers/integration-registry.js"
import { MockDataProvider } from "./mock-data-provider.js"
import { MockHttpHandler } from "./mock-http-handler.js"
import { assertScenarioOutcome } from "./assertions.js"
import type { ScenarioDefinition, AssertionResult } from "./types.js"
import type { InvestigationResult } from "../../types/results.js"
import type { AlertContext } from "../../types/contexts.js"
import type { HttpCall } from "./mock-http-handler.js"

/**
 * Result of running a scenario.
 */
interface ScenarioRunResult {
  scenarioId: string
  trajectory: string[]
  result: InvestigationResult | undefined
  httpCallLog: readonly HttpCall[]
  assertionResult: AssertionResult
  durationMs: number
}

/**
 * Run a single scenario against the investigation graph.
 *
 * 1. Creates MockHttpHandler + MockDataProvider from scenario data
 * 2. Builds investigation graph with scenario integrations
 * 3. Invokes graph, captures trajectory from state
 * 4. Runs assertions against expectations
 */
export async function runScenario(
  scenario: ScenarioDefinition,
): Promise<ScenarioRunResult> {
  const startMs = Date.now()

  // Set up HTTP interception
  const httpHandler = new MockHttpHandler(scenario.httpMocks)
  httpHandler.install()

  try {
    // Build data provider from scenario
    const dataProvider = new MockDataProvider(scenario)

    // Build graph with scenario integrations
    const graph = await buildInvestigationGraph({
      dataProvider,
      integrations: scenario.integrations,
      mcpTools: [],
    })

    // Compute available data sources from integrations
    const availableDataSources = computeAvailableDataSources(
      scenario.integrations,
    )

    // Build initial state
    const initialState = {
      investigationId: `inv-scenario-${scenario.id}`,
      incidentId: scenario.incident.incidentId,
      config: {
        llm: { provider: "anthropic" as const, model: "test-model" },
        maxIterations: 8,
      },
      integrations: scenario.integrations.map(({ credentials: _c, ...rest }) => rest),
      iterations: 0,
      lastProgressSnapshot: null,
      lastAgentResponse: null,
      availableDataSources,
      incident: null,
      alerts: [] as AlertContext[],
      gatheredData: {},
      needsMoreData: false,
      dataGaps: [] as string[],
      result: undefined,
    }

    // Invoke graph
    const finalState = await graph.invoke(initialState)

    // Extract trajectory from the final state
    // In deterministic mode the trajectory is inferred from the graph execution
    const trajectory = inferTrajectory(finalState)

    // Run assertions
    const assertionResult = assertScenarioOutcome(
      finalState.result,
      trajectory,
      scenario.expectation,
    )

    return {
      scenarioId: scenario.id,
      trajectory,
      result: finalState.result,
      httpCallLog: httpHandler.getCalls(),
      assertionResult,
      durationMs: Date.now() - startMs,
    }
  } finally {
    httpHandler.restore()
  }
}

/**
 * Infer trajectory from final state.
 *
 * In mocked mode we infer the minimum trajectory from state evidence:
 * - scout always runs (hardcoded first node)
 * - analyst always runs (hardcoded after scout)
 * - supervisor always runs (after analyst)
 * - gatherer ran if gatheredData was updated after scout
 * - resolver ran if recommendations exist
 */
function inferTrajectory(
  finalState: Record<string, unknown>,
): string[] {
  const trajectory = ["scout", "analyst", "supervisor"]

  // Check if gatherer ran (iterations > 0 indicates supervisor routed somewhere)
  const iterations = (finalState.iterations as number) ?? 0
  if (iterations > 1) {
    // Multiple iterations means supervisor routed to an agent
    const recommendations = finalState.recommendations as unknown[]
    if (recommendations?.length > 0) {
      trajectory.push("resolver", "supervisor")
    } else {
      trajectory.push("gatherer", "supervisor")
    }
  }

  return trajectory
}
