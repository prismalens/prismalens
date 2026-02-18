/**
 * Analyst node: Evaluate evidence per hypothesis.
 *
 * LLM + tools: evaluates evidence for/against each hypothesis.
 * Can make targeted queries to verify temporal correlations.
 *
 * Stub implementation — Phase 6 adds real LLM + tool evaluation.
 */

import type { AnalystState } from "../state.js"

/**
 * Evaluate evidence node.
 *
 * Stub: returns state unchanged.
 */
export async function evaluateEvidence(
  state: AnalystState,
): Promise<Partial<AnalystState>> {
  // Stub: will use LLM with EvidenceEvaluationSchema + tools
  void state
  return {}
}
