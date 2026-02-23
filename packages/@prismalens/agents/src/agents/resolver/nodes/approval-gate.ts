/**
 * Resolver node: Approval gate for high-risk actions.
 *
 * Deterministic + interrupt() for high-risk recommendations.
 * Low-risk recommendations pass through. High-risk recommendations
 * trigger interrupt() for human approval.
 *
 * Stub implementation — Phase 7 adds real interrupt() + risk checking.
 * Phase 5A: Produces self-assessment for supervisor routing.
 */

import type { ResolverState } from "../state.js"

/**
 * Approval gate node.
 *
 * Stub: passes through all recommendations and produces self-assessment.
 */
export async function approvalGate(
  state: ResolverState,
): Promise<Partial<ResolverState>> {
  return {
    lastAgentResponse: {
      agent: "resolver",
      status:
        state.recommendations.length > 0
          ? "completed"
          : "insufficient_context",
      summary: `Generated ${state.recommendations.length} recommendations`,
      recommendation: "__end__",
      reasoning: "Recommendations generated, investigation can complete",
    },
  }
}
