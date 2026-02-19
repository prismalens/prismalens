/**
 * Output types from investigation executor
 */

/**
 * Complete investigation result
 */
export interface InvestigationResult {
  investigationId: string
  status: "completed" | "failed" | "timeout"
  summary: string | null
  rootCause: string | null
  rootCauseCategory: string | null
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
  severity?: "critical" | "high" | "medium" | "low"
  metadata?: Record<string, unknown>
}

/**
 * Recommendation for fixing the issue
 */
export interface Recommendation {
  id: string
  type: "immediate" | "short_term" | "long_term"
  priority: "critical" | "high" | "medium" | "low"
  title: string
  description: string
  steps?: string[]
  estimatedImpact?: string
  estimatedEffort?: string
  tags?: string[]
  relatedHypothesisId?: string
  category?: string
  actionable?: boolean
}
