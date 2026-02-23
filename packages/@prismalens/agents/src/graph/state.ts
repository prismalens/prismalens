/**
 * LangGraph state annotation for investigation.
 *
 * 4-layer state structure:
 * Layer 1: Input (minimal identifiers + config)
 * Layer 2: Process control (supervisor manages via Command)
 * Layer 3: Gathered data (scout + gatherer populate)
 * Layer 4: Analysis results (append-only via reducers, subgraphs write directly)
 *
 * No `messages` channel in root state — agents write to typed channels.
 *
 * Note: Channels without reducers use last-value semantics (Annotation<T>()).
 * Initial values are set by the executor before graph.invoke().
 * Only append-only channels (errors, hypotheses, recommendations) use { reducer, default }.
 */

import { Annotation } from "@langchain/langgraph"
import type {
  IncidentContext,
  AlertContext,
  IntegrationContext,
} from "../types/contexts.js"
import type { InvestigationResult, Hypothesis, Recommendation } from "../types/results.js"
import type {
  InvestigationPhase,
  GatheredData,
  ProgressSnapshot,
} from "../types/state.js"
import type { InvestigationConfig } from "../types/inputs.js"

/**
 * Root investigation state annotation with typed channels and reducers.
 */
export const InvestigationStateAnnotation = Annotation.Root({
  // =========================================================================
  // Layer 1: Input (minimal)
  // =========================================================================
  investigationId: Annotation<string>(),
  incidentId: Annotation<string>(),
  config: Annotation<InvestigationConfig>(),
  integrations: Annotation<IntegrationContext[]>(),

  // =========================================================================
  // Layer 2: Process control (supervisor manages via Command)
  // =========================================================================
  phase: Annotation<InvestigationPhase>(),
  iterations: Annotation<number>(),
  lastProgressSnapshot: Annotation<ProgressSnapshot | null>(),
  errors: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // =========================================================================
  // Layer 2b: Skill tracking (gatherer progressive disclosure)
  // Phase 4: gatherer wrapper writes skill names here after load_skill tool calls.
  // The dedup reducer merges subgraph updates back into root state.
  // =========================================================================
  skillsLoaded: Annotation<string[]>({
    reducer: (current, update) => [...new Set([...current, ...update])],
    default: () => [],
  }),

  // =========================================================================
  // Layer 3: Gathered data (scout + gatherer populate)
  // =========================================================================
  incident: Annotation<IncidentContext | null>(),
  alerts: Annotation<AlertContext[]>(),
  gatheredData: Annotation<GatheredData>(),

  // =========================================================================
  // Layer 4: Data requests (analyst → supervisor → gatherer loop)
  // =========================================================================
  needsMoreData: Annotation<boolean>(),
  dataGaps: Annotation<string[]>(),

  // =========================================================================
  // Layer 5: Analysis results (append-only via reducers)
  // =========================================================================
  hypotheses: Annotation<Hypothesis[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  recommendations: Annotation<Recommendation[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // =========================================================================
  // Final result
  // =========================================================================
  result: Annotation<InvestigationResult | undefined>(),
})

/**
 * Type alias for the annotated state.
 */
export type InvestigationState = typeof InvestigationStateAnnotation.State
