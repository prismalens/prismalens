/**
 * Scenario eval target — wraps createEvalTarget() with MockDataProvider + MockHttpHandler.
 *
 * Looks up scenarios by ID from the catalog, installs HTTP mocks, and delegates
 * to the existing eval target. Real LLM calls, mock HTTP responses.
 */

import { createEvalTarget, buildLLMConfig } from "./target.js"
import { MockDataProvider } from "../__tests__/scenarios/mock-data-provider.js"
import { MockHttpHandler } from "../__tests__/scenarios/mock-http-handler.js"
import { ALL_SCENARIOS } from "../__tests__/scenarios/catalog/index.js"
import type { EvalOutput } from "./target.js"

/**
 * Create a LangSmith evaluate() target that runs scenarios with real LLM.
 *
 * Validates LLM config eagerly — fails fast if env vars are missing.
 * Each invocation:
 * 1. Looks up scenario by `scenarioId` from inputs
 * 2. Installs MockHttpHandler for the scenario's HTTP routes
 * 3. Delegates to createEvalTarget() with MockDataProvider
 * 4. Returns { trajectory, result } for evaluators
 */
export function createScenarioEvalTarget(): (
  inputs: Record<string, unknown>,
) => Promise<EvalOutput> {
  // Validate LLM config eagerly — fail fast if env vars missing
  buildLLMConfig()

  return async (inputs: Record<string, unknown>): Promise<EvalOutput> => {
    const scenarioId = inputs.scenarioId as string
    if (!scenarioId) {
      throw new Error("Dataset example must include 'scenarioId' in inputs")
    }

    const scenario = ALL_SCENARIOS.find((s) => s.id === scenarioId)
    if (!scenario) {
      throw new Error(
        `Unknown scenario: ${scenarioId}. Available: ${ALL_SCENARIOS.map((s) => s.id).join(", ")}`,
      )
    }

    const httpHandler = new MockHttpHandler(scenario.httpMocks)
    httpHandler.install()

    try {
      const target = createEvalTarget({
        dataProvider: new MockDataProvider(scenario),
        integrations: scenario.integrations,
      })

      return await target({ incidentId: scenario.incident.incidentId })
    } finally {
      httpHandler.restore()
    }
  }
}
