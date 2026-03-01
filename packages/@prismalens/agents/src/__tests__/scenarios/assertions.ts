/**
 * Assertion functions for scenario testing.
 *
 * Returns structured results without throwing — collects all failures
 * for diagnostics. Ported from evals/evaluators.ts patterns.
 */

import type { InvestigationResult } from "../../types/results.js"
import type { ScenarioExpectation, AssertionResult } from "./types.js"

// =============================================================================
// Graph-Level Assertions
// =============================================================================

/**
 * Assert the outcome of a full graph-level scenario.
 *
 * Checks: status, trajectory subsequence, rootCauseKeywords,
 * confidence threshold, completeness, rootCauseCategory.
 */
export function assertScenarioOutcome(
  result: InvestigationResult | undefined,
  trajectory: string[],
  expectation: ScenarioExpectation,
): AssertionResult {
  const failures: string[] = []
  const scores: Record<string, number> = {}

  // --- Status check ---
  if (!result) {
    failures.push("No result produced")
    return { passed: false, failures, scores: { status: 0, trajectory: 0, rootCause: 0 } }
  }

  scores.status = result.status === expectation.status ? 1 : 0
  if (result.status !== expectation.status) {
    failures.push(
      `Status: expected "${expectation.status}", got "${result.status}"`,
    )
  }

  // --- Trajectory subsequence ---
  scores.trajectory = scoreTrajectorySubsequence(
    trajectory,
    expectation.trajectorySubsequence,
  )
  if (scores.trajectory < 1) {
    failures.push(
      `Trajectory: expected subsequence [${expectation.trajectorySubsequence.join(", ")}] in [${trajectory.join(", ")}] (score: ${scores.trajectory.toFixed(2)})`,
    )
  }

  // --- Root cause keywords ---
  const rootCause = result.rootCause ?? ""
  const summary = result.summary ?? ""
  const combined = `${rootCause} ${summary}`.toLowerCase()

  const matchedKeywords = expectation.rootCauseKeywords.filter((kw) =>
    combined.includes(kw.toLowerCase()),
  )
  scores.rootCause =
    expectation.rootCauseKeywords.length > 0
      ? matchedKeywords.length / expectation.rootCauseKeywords.length
      : 1

  if (scores.rootCause < 1) {
    const missing = expectation.rootCauseKeywords.filter(
      (kw) => !combined.includes(kw.toLowerCase()),
    )
    failures.push(
      `Root cause keywords missing: [${missing.join(", ")}] in "${combined.slice(0, 200)}"`,
    )
  }

  // --- Confidence threshold ---
  if (expectation.minConfidence !== undefined) {
    const confidence = result.confidence ?? 0
    scores.confidence = confidence >= expectation.minConfidence ? 1 : 0
    if (confidence < expectation.minConfidence) {
      failures.push(
        `Confidence: expected >= ${expectation.minConfidence}, got ${confidence}`,
      )
    }
  }

  // --- Root cause category ---
  if (expectation.rootCauseCategory !== undefined) {
    scores.rootCauseCategory =
      result.rootCauseCategory === expectation.rootCauseCategory ? 1 : 0
    if (result.rootCauseCategory !== expectation.rootCauseCategory) {
      failures.push(
        `Root cause category: expected "${expectation.rootCauseCategory}", got "${result.rootCauseCategory}"`,
      )
    }
  }

  // --- Summary presence ---
  if (expectation.hasSummary) {
    const hasSummary = result.summary !== null && result.summary.length > 0
    scores.summary = hasSummary ? 1 : 0
    if (!hasSummary) {
      failures.push("Expected non-null summary")
    }
  }

  // --- Recommendations presence ---
  if (expectation.hasRecommendations) {
    const hasRecs = result.recommendations.length > 0
    scores.recommendations = hasRecs ? 1 : 0
    if (!hasRecs) {
      failures.push("Expected at least one recommendation")
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    scores,
  }
}

/**
 * Score trajectory subsequence matching.
 * Returns proportion of expected nodes found in order (0-1).
 */
function scoreTrajectorySubsequence(
  actual: string[],
  expected: string[],
): number {
  if (expected.length === 0) return 1

  let matchIdx = 0
  for (const node of actual) {
    if (matchIdx < expected.length && node === expected[matchIdx]) {
      matchIdx++
    }
  }

  return matchIdx / expected.length
}

