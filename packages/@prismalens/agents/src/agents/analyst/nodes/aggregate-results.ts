/**
 * Analyst node: Aggregate and rank hypotheses by evidence strength.
 *
 * Deterministic node — no LLM. Collects parallel hypothesis evaluation
 * results and ranks by evidence strength.
 *
 * Stub implementation — Phase 6 adds real aggregation logic.
 */

import type { AnalystState } from "../state.js"

/**
 * Aggregate results node.
 *
 * Stub: passes working hypotheses through unchanged.
 */
export async function aggregateResults(
  state: AnalystState,
): Promise<Partial<AnalystState>> {
  // Stub: will rank hypotheses by evidence strength
  return {
    workingHypotheses: [...state.workingHypotheses],
  }
}
