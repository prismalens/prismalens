/**
 * Node-level scenario types — per-node testing infrastructure.
 */

import type { InvestigationState } from "../../../types/state.js"

/**
 * Generic node scenario — describes input state + expected output.
 */
export interface NodeScenario<TExpectation> {
  id: string
  name: string
  description: string
  tags: string[]
  /** Partial InvestigationState to merge into buildTestState defaults */
  inputState: Partial<InvestigationState>
  /** What the node's output should contain */
  expectation: TExpectation
}

// =============================================================================
// Per-Node Expectation Types
// =============================================================================

export interface AnalystExpectation {
  /** Minimum number of hypotheses produced */
  minHypotheses: number
  /** Keywords expected in hypothesis descriptions */
  hypothesisKeywords: string[]
  /** Expected routing recommendation */
  recommendation: "gatherer" | "resolver" | "__end__"
  /** Whether needsMoreData should be true */
  needsMoreData?: boolean
  /** Expected hypothesis category */
  category?: string
}

export interface GathererExpectation {
  /** Status from agent self-assessment */
  status: "completed" | "needs_more_data" | "blocked"
  /** Agent recommendation after gathering */
  recommendation: "analyst"
  /** Whether summary is non-empty */
  hasSummary: boolean
}

export interface ResolverExpectation {
  /** Minimum recommendations produced */
  minRecommendations: number
  /** Keywords in recommendation descriptions */
  recommendationKeywords: string[]
  /** Expected routing recommendation */
  recommendation: "__end__" | "analyst"
  /** Whether result should have rootCause set */
  hasRootCause?: boolean
}

export interface SupervisorExpectation {
  /** Which node should be routed to */
  routeTo: "gatherer" | "analyst" | "resolver" | "__end__"
  /** Whether result should be compiled (only for __end__) */
  hasResult?: boolean
}
