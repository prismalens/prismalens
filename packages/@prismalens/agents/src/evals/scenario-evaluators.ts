/**
 * Scenario-specific evaluators for LangSmith evaluate().
 *
 * These evaluators read expected values from dataset example outputs and score
 * the actual eval run. They complement the generic evaluators in evaluators.ts
 * with scenario-specific expectations.
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
// Scenario Evaluators
// =============================================================================

/**
 * Check that an expected node sequence is a subsequence of the actual trajectory.
 *
 * Reads `trajectorySubsequence` from example.outputs.
 * Score = proportion of expected nodes found in order.
 */
export function scenarioTrajectory(input: EvaluatorInput): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const expected = (input.example.outputs?.trajectorySubsequence ?? []) as string[]
  const actual = outputs?.trajectory ?? []

  if (expected.length === 0) {
    return {
      key: "scenario_trajectory",
      score: 1.0,
      comment: "No expected trajectory defined",
    }
  }

  let matchIdx = 0
  for (const node of actual) {
    if (matchIdx < expected.length && node === expected[matchIdx]) {
      matchIdx++
    }
  }

  const score = matchIdx / expected.length

  return {
    key: "scenario_trajectory",
    score,
    comment: `Matched ${matchIdx}/${expected.length} expected nodes. Actual: [${actual.join(", ")}]`,
  }
}

/**
 * Check that expected keywords appear in the root cause or summary.
 *
 * Reads `rootCauseKeywords` from example.outputs.
 * Score = proportion of keywords found (case-insensitive).
 */
export function scenarioRootCauseKeywords(
  input: EvaluatorInput,
): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const keywords = (input.example.outputs?.rootCauseKeywords ?? []) as string[]
  const result = outputs?.result

  if (keywords.length === 0) {
    return {
      key: "scenario_root_cause_keywords",
      score: 1.0,
      comment: "No expected keywords defined",
    }
  }

  if (!result) {
    return {
      key: "scenario_root_cause_keywords",
      score: 0,
      comment: "No result produced",
    }
  }

  const rootCause = result.rootCause ?? ""
  const summary = result.summary ?? ""
  const combined = `${rootCause} ${summary}`.toLowerCase()

  const matched = keywords.filter((kw) => combined.includes(kw.toLowerCase()))
  const score = matched.length / keywords.length

  return {
    key: "scenario_root_cause_keywords",
    score,
    comment:
      score === 1
        ? `All ${keywords.length} keywords found`
        : `${matched.length}/${keywords.length} keywords found. Missing: [${keywords.filter((kw) => !combined.includes(kw.toLowerCase())).join(", ")}]`,
  }
}

/**
 * Check that the result confidence meets the minimum threshold.
 *
 * Reads `minConfidence` from example.outputs.
 * Score = 1 if confidence >= threshold, 0 otherwise.
 */
export function scenarioConfidence(input: EvaluatorInput): EvaluatorResult {
  const outputs = input.run.outputs as EvalOutput | undefined
  const minConfidence = input.example.outputs?.minConfidence as
    | number
    | undefined
  const result = outputs?.result

  if (minConfidence === undefined) {
    return {
      key: "scenario_confidence",
      score: 1.0,
      comment: "No minimum confidence defined",
    }
  }

  if (!result) {
    return {
      key: "scenario_confidence",
      score: 0,
      comment: "No result produced",
    }
  }

  const confidence = result.confidence ?? 0
  const score = confidence >= minConfidence ? 1 : 0

  return {
    key: "scenario_confidence",
    score,
    comment: `Confidence: ${confidence.toFixed(2)} (threshold: ${minConfidence})`,
  }
}
