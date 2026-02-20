/**
 * Supervisor node — central orchestrator with Command routing.
 *
 * Responsibilities:
 * - Deterministic guards (budget, stall detection, ordering)
 * - LLM routing decision with structured output
 * - Progress tracking via ProgressSnapshot
 *
 * Stub implementation — Phase 5 adds full LLM routing.
 */

import { Command } from "@langchain/langgraph"
import type { InvestigationState } from "../../types/state.js"
import type { InvestigationResult } from "../../types/results.js"
import type { ProgressSnapshot } from "../../types/state.js"
import { mapHypothesisCategoryToDb } from "../../utils/enum-maps.js"

/**
 * Compile a partial result from current state.
 * Produces maximally useful output even when investigation is incomplete.
 */
export function compilePartialResult(
  state: InvestigationState,
): InvestigationResult {
  const bestHypothesis = state.hypotheses.length > 0
    ? state.hypotheses.reduce((best, h) =>
        h.confidence > best.confidence ? h : best,
      )
    : null

  return {
    investigationId: state.investigationId,
    status: "completed",
    summary: bestHypothesis
      ? `Partial analysis: ${bestHypothesis.description}`
      : "Investigation completed with partial data",
    rootCause: bestHypothesis?.description ?? null,
    rootCauseCategory: bestHypothesis?.category
      ? mapHypothesisCategoryToDb(bestHypothesis.category)
      : null,
    confidence: bestHypothesis?.confidence ?? null,
    hypotheses: state.hypotheses,
    recommendations: state.recommendations,
    error: state.errors.length > 0 ? state.errors.join("; ") : null,
    executionTimeMs: 0,
    analysisMethod: "multi-agent",
  }
}

/**
 * Take a progress snapshot for stall detection.
 */
export function takeProgressSnapshot(
  state: InvestigationState,
): ProgressSnapshot {
  return {
    dataGaps: [...(state.dataGaps ?? [])],
    sourcesQueried: [
      ...(state.gatheredData?.coverage?.sourcesQueried ?? []),
    ],
    hypothesisCount: state.hypotheses.length,
    bestConfidence:
      state.hypotheses.length > 0
        ? Math.max(...state.hypotheses.map((h) => h.confidence))
        : null,
    recommendationCount: state.recommendations.length,
  }
}

/**
 * Detect whether the investigation has made forward progress.
 */
export function detectProgress(
  state: InvestigationState,
): { stalled: boolean; reason?: string } {
  if (!state.lastProgressSnapshot) return { stalled: false }

  const prev = state.lastProgressSnapshot
  const curr = takeProgressSnapshot(state)

  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i])

  if (
    arraysEqual(prev.dataGaps, curr.dataGaps) &&
    curr.dataGaps.length > 0 &&
    arraysEqual(prev.sourcesQueried, curr.sourcesQueried)
  ) {
    return { stalled: true, reason: "data gaps unchanged after gatherer run" }
  }

  if (
    prev.hypothesisCount === curr.hypothesisCount &&
    prev.bestConfidence === curr.bestConfidence &&
    prev.recommendationCount === curr.recommendationCount &&
    arraysEqual(prev.sourcesQueried, curr.sourcesQueried)
  ) {
    return {
      stalled: true,
      reason: "no measurable progress in last iteration",
    }
  }

  return { stalled: false }
}

/**
 * Check if state has a high-confidence similar incident match.
 */
export function hasHighConfidenceSimilarIncident(
  _state: InvestigationState,
): boolean {
  // Stub: always returns false until similar incident matching is implemented
  return false
}

/**
 * Supervisor node — returns Command({ goto, update }).
 *
 * Stub: routes to __end__ with a dummy result.
 * Phase 5 implements full LLM routing with guards.
 */
export async function supervisorNode(
  state: InvestigationState,
): Promise<Command> {
  // Stub: immediately complete
  return new Command({
    update: {
      result: compilePartialResult(state),
      phase: "completed" as const,
    },
    goto: "__end__",
  })
}
