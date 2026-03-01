/**
 * Core types for scenario-based testing.
 *
 * ScenarioDefinition describes a complete test scenario with embedded
 * incident data, integration credentials, HTTP mocks, and expectations.
 */

import type {
  IncidentContext,
  AlertContext,
  IntegrationWithCredentials,
  SimilarIncidentMatch,
} from "../../types/contexts.js"
import type { ChangeEventContext } from "../../providers/data-provider.js"
import type { RootCauseCategory } from "@prismalens/contracts/schemas"

// =============================================================================
// Difficulty + Classification
// =============================================================================

export type DifficultyTier = "easy" | "medium" | "hard"

// =============================================================================
// HTTP Mock Routes
// =============================================================================

/**
 * A single HTTP mock route — intercepts fetch() calls matching the pattern.
 * Routes are matched by integration type (detected from URL domain) + path.
 */
export interface MockHttpRoute {
  /** Integration type to match (e.g., "render", "github") */
  integration: string
  /** Path pattern — string for prefix match, RegExp for regex match */
  pathPattern: string | RegExp
  /** Optional query parameter subset to match */
  queryMatch?: Record<string, string>
  /** Response body to return */
  responseBody: unknown
  /** HTTP status code (default: 200) */
  status?: number
}

// =============================================================================
// Scenario Expectations
// =============================================================================

/**
 * Expected outcome of a full graph-level scenario execution.
 */
export interface ScenarioExpectation {
  /** Expected investigation result status */
  status: "completed" | "failed" | "timeout"
  /** Minimum confidence threshold for the best hypothesis */
  minConfidence?: number
  /** Keywords expected in the root cause description */
  rootCauseKeywords: string[]
  /** Expected root cause category */
  rootCauseCategory?: RootCauseCategory
  /** Expected subsequence of graph nodes visited */
  trajectorySubsequence: string[]
  /** Whether the result should have a non-null summary */
  hasSummary?: boolean
  /** Whether the result should have recommendations */
  hasRecommendations?: boolean
}

// =============================================================================
// Scenario Definition
// =============================================================================

/**
 * Complete scenario definition — self-contained test data + expectations.
 */
export interface ScenarioDefinition {
  /** Unique scenario ID */
  id: string
  /** Human-readable name */
  name: string
  /** Root cause category for classification */
  category: string
  /** Difficulty tier — controls assertion thresholds */
  difficulty: DifficultyTier
  /** Tags for filtering (e.g., ["github", "render", "npe"]) */
  tags: string[]
  /** Incident context data */
  incident: IncidentContext
  /** Alert contexts */
  alerts: AlertContext[]
  /** Optional change events */
  changeEvents?: ChangeEventContext[]
  /** Optional similar past incidents */
  similarIncidents?: SimilarIncidentMatch[]
  /** Integration credentials for http_request tool */
  integrations: IntegrationWithCredentials[]
  /** HTTP mock routes for intercepting fetch() calls */
  httpMocks: MockHttpRoute[]
  /** Expected outcome */
  expectation: ScenarioExpectation
}

// =============================================================================
// Assertion Result
// =============================================================================

/**
 * Structured assertion result — collects all failures without throwing.
 */
export interface AssertionResult {
  passed: boolean
  failures: string[]
  scores: Record<string, number>
}
