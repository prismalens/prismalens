/**
 * Investigation state types for LangGraph.
 *
 * These types define the phases, agent names, and progress tracking
 * used by the supervisor for routing decisions and stall detection.
 */

import type {
  IncidentContext,
  AlertContext,
  IntegrationContext,
} from "./contexts.js"
import type { InvestigationResult, Hypothesis, Recommendation } from "./results.js"
import type { InvestigationConfig } from "./inputs.js"

/**
 * Investigation phase — detailed workflow stage.
 */
export type InvestigationPhase =
  | "pre_gathering"
  | "gathering"
  | "analysis"
  | "resolution"
  | "completed"

/**
 * Supervisor phase — alias for InvestigationPhase (used in supervisor routing).
 */
export type SupervisorPhase = InvestigationPhase

/**
 * Agent name — identifies which agent node is active.
 */
export type AgentName = "scout" | "gatherer" | "analyst" | "resolver" | "supervisor"

/**
 * Graph node ID — all possible node names in the investigation graph.
 */
export type GraphNodeId = AgentName | "__start__" | "__end__"

/**
 * Coverage assessment for gathered data quality gate.
 */
export interface DataCoverage {
  sourcesQueried: string[]
  sourcesWithData: string[]
  temporalOverlap?: boolean
  dataGaps: string[]
}

/**
 * Gathered data from scout + gatherer nodes.
 */
export interface GatheredData {
  logs?: unknown[]
  commits?: unknown[]
  deployments?: unknown[]
  metrics?: unknown[]
  codeSearchResults?: unknown[]
  coverage?: DataCoverage
}

/**
 * Progress snapshot for supervisor stall detection.
 * Compared between iterations to detect forward progress.
 */
export interface ProgressSnapshot {
  dataGaps: string[]
  sourcesQueried: string[]
  hypothesisCount: number
  bestConfidence: number | null
  recommendationCount: number
}

/**
 * Full investigation state — 4-layer structure.
 *
 * Layer 1: Input (minimal identifiers + config)
 * Layer 2: Process control (supervisor manages via Command)
 * Layer 3: Gathered data (scout + gatherer populate)
 * Layer 4: Analysis results (append-only via reducers)
 */
export interface InvestigationState {
  // Layer 1: Input
  investigationId: string
  incidentId: string
  config: InvestigationConfig
  integrations: IntegrationContext[]

  // Layer 2: Process control
  phase: InvestigationPhase
  iterations: number
  lastProgressSnapshot: ProgressSnapshot | null
  errors: string[]

  // Layer 3: Gathered data
  incident: IncidentContext | null
  alerts: AlertContext[]
  gatheredData: GatheredData

  // Layer 4: Data requests (analyst → supervisor → gatherer loop)
  needsMoreData: boolean
  dataGaps: string[]

  // Layer 5: Analysis results (append-only)
  hypotheses: Hypothesis[]
  recommendations: Recommendation[]

  // Final result
  result?: InvestigationResult
}
