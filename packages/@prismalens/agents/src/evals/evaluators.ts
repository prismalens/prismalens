/**
 * Evaluation scoring functions for LangSmith evaluate().
 *
 * Two categories:
 * - Deterministic (code-based, free, every PR): trajectorySubsequence, resultCompleteness, terminatedCorrectly
 * - Non-deterministic (LLM judge, expensive, nightly): trajectoryLLMJudge, outputQualityJudge
 */

import type { EvalOutput } from "./target.js"

// =============================================================================
// Types — LangSmith evaluator interface
// =============================================================================

interface EvaluatorInput {
  run: { outputs?: Record<string, unknown> }
  example: { outputs?: Record<string, unknown> }
}

interface EvaluatorResult {
  key: string
  score: number
  comment?: string
}

// =============================================================================
// Deterministic Evaluators
// =============================================================================

/**
 * Check that an expected node sequence is a subsequence of the actual trajectory.
 *
 * Score = proportion of expected nodes found in order.
 * A subsequence allows gaps (e.g., expected [scout, analyst, supervisor]
 * matches actual [scout, analyst, supervisor, gatherer, supervisor, resolver]).
 */
function trajectorySubsequence(input: EvaluatorInput): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const expected = (input.example.outputs?.trajectory ?? []) as string[]
  const actual = outputs?.trajectory ?? []

  if (expected.length === 0) {
    return { key: "trajectory_subsequence", score: 1.0, comment: "No expected trajectory defined" }
  }

  let matchIdx = 0
  for (const node of actual) {
    if (matchIdx < expected.length && node === expected[matchIdx]) {
      matchIdx++
    }
  }

  const score = matchIdx / expected.length

  return {
    key: "trajectory_subsequence",
    score,
    comment: `Matched ${matchIdx}/${expected.length} expected nodes. Actual: [${actual.join(", ")}]`,
  }
}

/**
 * Check that key result fields are present and non-null.
 *
 * Score = proportion of required fields that are non-null.
 */
export function resultCompleteness(input: EvaluatorInput): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const result = outputs?.result

  if (!result) {
    return { key: "result_completeness", score: 0, comment: "No result produced" }
  }

  const requiredFields = ["summary", "rootCause", "confidence", "recommendations"] as const
  const present = requiredFields.filter((field) => {
    const value = result[field]
    if (value === null || value === undefined) return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  })

  const score = present.length / requiredFields.length

  return {
    key: "result_completeness",
    score,
    comment: `${present.length}/${requiredFields.length} fields present: [${present.join(", ")}]`,
  }
}

/**
 * Check that the investigation terminated successfully (not failed/timeout).
 *
 * Score = 1 if status is "completed", 0 otherwise.
 */
export function terminatedCorrectly(input: EvaluatorInput): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const result = outputs?.result

  if (!result) {
    return { key: "terminated_correctly", score: 0, comment: "No result produced" }
  }

  const score = result.status === "completed" ? 1 : 0

  return {
    key: "terminated_correctly",
    score,
    comment: `Status: ${result.status}${result.error ? ` — ${result.error}` : ""}`,
  }
}

// =============================================================================
// Non-Deterministic Evaluators (LLM Judge)
// =============================================================================

/**
 * Create a trajectory LLM judge using the agentevals library.
 *
 * Evaluates whether the agent steps were logical and efficient.
 * Gated behind EVAL_LLM_JUDGE=true in the eval runners.
 */
async function createTrajectoryJudge() {
  const { createTrajectoryLLMAsJudge, TRAJECTORY_ACCURACY_PROMPT } = await import("agentevals")

  return createTrajectoryLLMAsJudge({
    prompt: TRAJECTORY_ACCURACY_PROMPT,
    model: "anthropic:claude-sonnet-4-20250514",
  })
}

/**
 * Output quality LLM judge — evaluates root cause groundedness and summary quality.
 *
 * Returns a LangSmith-compatible evaluator function.
 */
export function outputQualityJudge(input: EvaluatorInput): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const result = outputs?.result

  if (!result) {
    return { key: "output_quality", score: 0, comment: "No result produced" }
  }

  // For the deterministic fallback (when LLM judge is not available),
  // score based on structural quality indicators
  let score = 0
  const checks: string[] = []

  // Root cause present and substantive (>20 chars)
  if (result.rootCause && result.rootCause.length > 20) {
    score += 0.25
    checks.push("rootCause")
  }

  // Summary present and substantive (>50 chars)
  if (result.summary && result.summary.length > 50) {
    score += 0.25
    checks.push("summary")
  }

  // Confidence is reasonable (0.3-1.0)
  if (result.confidence !== null && result.confidence >= 0.3) {
    score += 0.25
    checks.push("confidence")
  }

  // Has actionable recommendations
  if (result.recommendations.length > 0) {
    score += 0.25
    checks.push("recommendations")
  }

  return {
    key: "output_quality",
    score,
    comment: `Quality checks passed: [${checks.join(", ")}]`,
  }
}
