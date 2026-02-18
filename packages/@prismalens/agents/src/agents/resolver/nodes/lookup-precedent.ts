/**
 * Resolver node: Look up precedent from runbooks and past resolutions.
 *
 * Tools: searches runbooks and past incident resolutions matching
 * the confirmed root cause.
 *
 * Stub implementation — Phase 7 adds real tool calls.
 */

import type { ResolverState } from "../state.js"

/**
 * Lookup precedent node.
 *
 * Stub: returns empty precedent results.
 */
export async function lookupPrecedent(
  state: ResolverState,
): Promise<Partial<ResolverState>> {
  // Stub: will use searchRunbooks + lookupPastResolutions tools
  void state
  return {
    precedentResults: [],
  }
}
