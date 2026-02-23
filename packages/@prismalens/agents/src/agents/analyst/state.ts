/**
 * Analyst state annotation.
 *
 * Defines channels for the analyst subgraph. Channels with matching names
 * between parent and child are automatically shared by LangGraph.
 */

import { Annotation } from "@langchain/langgraph"
import type { Hypothesis } from "../../types/results.js"
import type {
  GatheredData,
  AgentSelfAssessment,
  AvailableDataSource,
} from "../../types/state.js"
import type { IncidentContext, AlertContext } from "../../types/contexts.js"

/**
 * AnalystStateAnnotation — state for the analyst subgraph.
 *
 * Shared channels with parent: hypotheses, needsMoreData, dataGaps, lastAgentResponse
 * Read from parent: gatheredData, availableDataSources, incident, alerts
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
  lastAgentResponse: Annotation<AgentSelfAssessment | null>(),

  // Read from parent
  gatheredData: Annotation<GatheredData>(),
  availableDataSources: Annotation<AvailableDataSource[]>(),
  incident: Annotation<IncidentContext | null>(),
  alerts: Annotation<AlertContext[]>(),

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
