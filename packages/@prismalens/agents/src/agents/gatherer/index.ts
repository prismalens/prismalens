/**
 * Gatherer agent — createReactAgent wrapper with skill-based tools.
 *
 * Wraps createReactAgent in a function node. The wrapper invokes the agent
 * and extracts structured gatheredData from the agent's messages.
 *
 * Why a wrapper: createReactAgent only writes to `messages`. Our parent
 * state needs structured `gatheredData`. The wrapper transforms messages → gatheredData.
 *
 * Stub implementation — Phase 4 adds real createReactAgent with skill tools.
 */

import type { InvestigationState, GatheredData } from "../../types/state.js"
import type { IntegrationContext } from "../../types/contexts.js"

export { GathererStateAnnotation } from "./state.js"
export type { GathererState } from "./state.js"
export { gathererPrompt, GATHERER_PROMPT } from "./prompt.js"

/**
 * Extract structured gatheredData from agent messages.
 *
 * Stub: returns existing gathered data unchanged.
 * Phase 4 implements real message → gatheredData extraction.
 */
export function extractGatheredData(
  _messages: unknown[],
  existingData: GatheredData,
): GatheredData {
  return { ...existingData }
}

/**
 * Create the gatherer function node.
 *
 * Stub: returns state unchanged. Phase 4 implements createReactAgent wrapper.
 */
export function createGathererNode(
  _integrations: IntegrationContext[],
  _mcpTools: unknown[] = [],
) {
  return async (
    state: InvestigationState,
  ): Promise<Partial<InvestigationState>> => {
    // Stub: no data gathering yet
    return {
      gatheredData: state.gatheredData,
    }
  }
}
