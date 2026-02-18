/**
 * Resolver state annotation.
 *
 * Defines channels for the resolver subgraph. Channels with matching names
 * between parent and child are automatically shared by LangGraph.
 */

import { Annotation } from "@langchain/langgraph"
import type { Hypothesis, Recommendation } from "../../types/results.js"
import type { GatheredData } from "../../types/state.js"

/**
 * ResolverStateAnnotation — state for the resolver subgraph.
 *
 * Shared channels with parent: recommendations
 * Read from parent: hypotheses, gatheredData
 */
export const ResolverStateAnnotation = Annotation.Root({
  // Shared with parent (matching names = auto-shared)
  recommendations: Annotation<Recommendation[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // Read from parent
  hypotheses: Annotation<Hypothesis[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  gatheredData: Annotation<GatheredData>(),

  // Internal working state
  precedentResults: Annotation<unknown[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  riskAssessments: Annotation<unknown[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
})

export type ResolverState = typeof ResolverStateAnnotation.State
