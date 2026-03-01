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
 * Run:
 *   pnpm -F @prismalens/agents eval:scenarios
 */

import { describe, it } from "vitest"
import { evaluate } from "langsmith/evaluation"
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

    await evaluate(target, {
      data: "prismalens-scenarios",
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
