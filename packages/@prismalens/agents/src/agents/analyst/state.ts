/**
 * Analyst state annotation.
 *
 * Defines channels for the analyst subgraph. Channels with matching names
 * between parent and child are automatically shared by LangGraph.
 */

import { Annotation } from "@langchain/langgraph"
import type { Hypothesis } from "../../types/results.js"
import type { GatheredData } from "../../types/state.js"

/**
 * AnalystStateAnnotation — state for the analyst subgraph.
 *
 * Shared channels with parent: hypotheses, needsMoreData, dataGaps
 * Internal channels: workingHypotheses, challengeResults
 */
export const AnalystStateAnnotation = Annotation.Root({
  // Shared with parent (matching names = auto-shared)
  hypotheses: Annotation<Hypothesis[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  needsMoreData: Annotation<boolean>(),
  dataGaps: Annotation<string[]>(),

  // Read from parent
  gatheredData: Annotation<GatheredData>(),

  // Internal working state
  workingHypotheses: Annotation<Hypothesis[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  challengeResults: Annotation<unknown[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
})

export type AnalystState = typeof AnalystStateAnnotation.State
