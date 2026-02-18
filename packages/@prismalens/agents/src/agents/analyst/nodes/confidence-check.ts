/**
 * Analyst node: Structured confidence scoring.
 *
 * Deterministic node — no LLM guessing. Uses structured scoring:
 * - Temporal correlation score
 * - Evidence ratio (supporting / total)
 * - Counter-evidence penalty
 * - Precedent match score
 *
 * Routes: HIGH confidence → END, LOW + verifiable → evaluate_evidence loop,
 * LOW + needs more data → END (writes dataGaps to state).
 *
 * Stub implementation — Phase 6 adds real confidence scoring.
 */

import type { AnalystState } from "../state.js"

/**
 * Confidence check node.
 *
 * Stub: writes working hypotheses to final hypotheses channel and ends.
 */
export async function confidenceCheck(
  state: AnalystState,
): Promise<Partial<AnalystState>> {
  // Stub: promote working hypotheses to final output
  return {
    hypotheses: state.workingHypotheses,
    needsMoreData: false,
    dataGaps: [],
  }
}
