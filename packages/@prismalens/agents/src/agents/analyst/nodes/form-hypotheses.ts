/**
 * Analyst node: Form hypotheses from gathered data + RAG.
 *
 * LLM forms root cause hypotheses from gathered data and searches
 * similar past incidents for pattern matching. May generate multiple
 * competing hypotheses.
 *
 * Stub implementation — Phase 6 adds real LLM + RAG.
 */

import type { AnalystState } from "../state.js"

/**
 * Form hypotheses node.
 *
 * Stub: returns empty working hypotheses.
 */
export async function formHypotheses(
  state: AnalystState,
): Promise<Partial<AnalystState>> {
  // Stub: will use LLM with HypothesisFormationSchema
  void state
  return {
    workingHypotheses: [],
  }
}
