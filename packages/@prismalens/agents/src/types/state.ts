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
import type { AgentId } from "@prismalens/config/agents"
import type { InvestigationPhaseValue } from "../tools/schemas.js"

/**
 * Investigation phase — detailed workflow stage.
 * Derived from the INVESTIGATION_PHASES constant in tools/schemas.ts.
 */
export type InvestigationPhase = InvestigationPhaseValue

/**
 * Supervisor phase — alias for InvestigationPhase (used in supervisor routing).
 */
export type SupervisorPhase = InvestigationPhase

/**
 * Agent name — identifies which agent node is active.
 * Derived from the config SSOT.
 */
export type AgentName = AgentId

/**
 * Graph node ID — all possible node names in the investigation graph.
 */
export type GraphNodeId = AgentName | "__start__" | "__end__"

/**
 * Per-source coverage metadata — reports what was fetched vs what's available.
 */
export interface SourceCoverage {
  fetched: number
  total: number | null // null = unknown (DataProvider didn't report total)
  sampled: boolean // true if fetched < total
}

/**
 * Rich coverage metadata — the scout's primary output.
 * Reports per-source fetch counts, totals, sampling flags, and data completeness.
 * The LLM-driven gatherer (Phase 3+) uses this to make targeted follow-up requests.
 */
export interface DataCoverage {
  // Per-source coverage
  incident: { found: boolean }
  alerts: SourceCoverage
  changeEvents: SourceCoverage | null // null = not queried (method missing or skipped)
  similarIncidents: SourceCoverage | null // null = not queried

  // Aggregated signals for LLM
  services: { detected: string[]; count: number }
  dataCompleteness: "complete" | "sampled" | "partial"
  dataGaps: string[] // sources not queried or with no data
  temporalOverlap: boolean // do alerts span a meaningful time range?
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
  changeEvents?: unknown[]
  similarIncidents?: unknown[]
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
 * Structured data request from analyst to gatherer.
 * Enables targeted data collection instead of blind gathering.
 */
export interface DataRequest {
  /**
   * What type of data is needed.
   * Note: "metrics" has no built-in skill yet (planned for Phase 8 MCP tools).
   * computeAvailableDataSources() won't produce it until a metrics skill exists.
   */
  source: "logs" | "code" | "commits" | "deployments" | "metrics" | "runbooks"
  /** Which services/repos/systems to query */
  targets?: string[]
  /** Specific search terms or patterns */
  query?: string
  /** Time range if applicable */
  timeRange?: { start: string; end: string }
  /** How important this request is */
  priority: "required" | "nice_to_have"
  /** Why this data is needed for the investigation */
  reasoning: string
}

/**
 * Structured self-assessment returned by each agent after execution.
 * The supervisor reads this to make informed routing decisions.
 */
export interface AgentSelfAssessment {
  /** Which agent produced this assessment */
  agent: string
  /** What the agent accomplished */
  status: "completed" | "needs_more_data" | "blocked" | "insufficient_context"
  /** Human-readable summary of what was done */
  summary: string
  /** Agent's recommendation for what should happen next */
  recommendation?: string
  /** Targeted data requests for the gatherer */
  dataRequests?: DataRequest[]
  /** Brief reasoning for the recommendation */
  reasoning: string
}

/**
 * Describes a data source available to the gatherer.
 * Computed once from integrations at graph init — the analyst reads this
 * to know which DataRequest.source values are valid.
 */
export interface AvailableDataSource {
  /** Data source category (matches DataRequest.source) */
  source: DataRequest["source"]
  /** Which integration provides this (e.g., "github", "built-in", "confluence") */
  provider: string
  /** Human description of what this source provides */
  description: string
}

/**
 * Full investigation state — 5-layer structure.
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

  // Layer 2b: Skill tracking (gatherer progressive disclosure)
  skillsLoaded: string[]

  // Layer 2c: Agent communication
  lastAgentResponse: AgentSelfAssessment | null
  availableDataSources: AvailableDataSource[]

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
