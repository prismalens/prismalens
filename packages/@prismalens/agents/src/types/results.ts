/**
 * Output types from investigation executor
 */

import type {
  EffortEstimate,
  RecommendationCategory,
  Severity,
  RootCauseCategory,
  RecommendationPriority,
  Urgency,
} from "@prismalens/contracts/schemas"

/**
 * Complete investigation result
 */
export interface InvestigationResult {
  investigationId: string
  status: "completed" | "failed" | "timeout"
  summary: string | null
  rootCause: string | null
  rootCauseCategory: RootCauseCategory | null
  confidence: number | null
  hypotheses: Hypothesis[]
  recommendations: Recommendation[]
  error: string | null
  executionTimeMs: number
  analysisMethod: string | null
}

/**
 * Hypothesis about the root cause
 */
export interface Hypothesis {
  id: string
  description: string
  confidence: number
  evidence: Evidence[]
  category?: string
  reasoning?: string
  createdAt?: Date
}

/**
 * Evidence supporting a hypothesis
 */
export interface Evidence {
  type: "metric" | "log" | "trace" | "alert" | "incident" | "other"
  description: string
  source?: string
  timestamp?: Date
  severity?: Severity
  metadata?: Record<string, unknown>
}

/**
 * Recommendation for fixing the issue
 */
export interface Recommendation {
  id: string
  urgency: Urgency
  priority: RecommendationPriority
  title: string
  description: string
  steps?: string[]
  estimatedImpact?: string
  estimatedEffort?: EffortEstimate
  tags?: string[]
  relatedHypothesisId?: string
  category?: RecommendationCategory
  actionable?: boolean
}
