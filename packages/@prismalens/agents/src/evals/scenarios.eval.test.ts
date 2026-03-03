/**
 * Scenario evals — real LLM calls against self-contained scenarios.
 *
 * Gated behind RUN_EVALS=true. Uses LangSmith evaluate() for structured
 * experiments visible in the LangSmith UI.
 *
 * Requires:
 * - LANGSMITH_API_KEY — LangSmith API key
 * - PRISMALENS_LLM_PROVIDER — e.g., "anthropic" (no default)
 * - PRISMALENS_LLM_MODEL — e.g., "claude-haiku-4-5-20251001" (no default)
 * - ANTHROPIC_API_KEY (or provider-specific key)
 *
 * Run all:
 *   pnpm -F @prismalens/agents eval:scenarios
 *
 * Run single scenario:
 *   SCENARIO=connection-pool pnpm -F @prismalens/agents eval:scenarios
 */

import { Client } from "langsmith"
import { evaluate } from "langsmith/evaluation"
import type { Example } from "langsmith/schemas"
import { describe, it } from "vitest"

import { createScenarioEvalTarget } from "./scenario-target.js"
import {
  scenarioTrajectory,
  scenarioRootCauseKeywords,
  scenarioConfidence,
} from "./scenario-evaluators.js"
import {
  resultCompleteness,
  terminatedCorrectly,
  outputQualityJudge,
} from "./evaluators.js"

describe.runIf(process.env.RUN_EVALS === "true")("Scenario Evals", () => {
  it("evaluates LLM reasoning on self-contained scenarios", {
    timeout: 1_200_000,
  }, async () => {
    const target = createScenarioEvalTarget()
    const scenarioFilter = process.env.SCENARIO

    // When SCENARIO env var is set, filter dataset to that single example.
    // This allows running/debugging one scenario at a time.
    let data: Parameters<typeof evaluate>[1]["data"] = "prismalens-scenarios"

    if (scenarioFilter) {
      const client = new Client()
      const filtered: Example[] = []
      for await (const example of client.listExamples({
        datasetName: "prismalens-scenarios",
      })) {
        if (example.inputs.scenarioId === scenarioFilter) {
          filtered.push(example)
        }
      }
      if (filtered.length === 0) {
        throw new Error(`No dataset example found for SCENARIO=${scenarioFilter}`)
      }
      data = filtered
    }

    await evaluate(target, {
      data,
      evaluators: [
        scenarioTrajectory,
        scenarioRootCauseKeywords,
        scenarioConfidence,
        resultCompleteness,
        terminatedCorrectly,
        outputQualityJudge,
      ],
      experimentPrefix: `scenarios-${process.env.GIT_SHA ?? "local"}`,
    })
  })
})
