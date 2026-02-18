/**
 * Analyst node: Challenge hypotheses by searching for contradictions.
 *
 * LLM + verification tools: actively searches for contradicting patterns.
 * Predicts observable consequences of hypothesized root cause and checks
 * if those consequences appear in gathered data.
 *
 * Stub implementation — Phase 6 adds real LLM + verification.
 */

import type { AnalystState } from "../state.js"

/**
 * Challenge node.
 *
 * Stub: returns empty challenge results.
 */
export async function challenge(
  state: AnalystState,
): Promise<Partial<AnalystState>> {
  // Stub: will use LLM with ChallengeResultSchema + verification tools
  void state
  return {
    challengeResults: [],
  }
}
