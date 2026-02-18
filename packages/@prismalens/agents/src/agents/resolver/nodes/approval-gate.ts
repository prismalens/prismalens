/**
 * Resolver node: Approval gate for high-risk actions.
 *
 * Deterministic + interrupt() for high-risk recommendations.
 * Low-risk recommendations pass through. High-risk recommendations
 * trigger interrupt() for human approval.
 *
 * Stub implementation — Phase 7 adds real interrupt() + risk checking.
 */

import type { ResolverState } from "../state.js"

/**
 * Approval gate node.
 *
 * Stub: passes through all recommendations without gating.
 */
export async function approvalGate(
  state: ResolverState,
): Promise<Partial<ResolverState>> {
  // Stub: will check risk levels and interrupt() for high-risk
  void state
  return {}
}
