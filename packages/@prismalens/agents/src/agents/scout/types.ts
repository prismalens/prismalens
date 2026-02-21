/**
 * Scout enrichment types — computed from fetched data.
 *
 * These are secondary value-adds the scout produces alongside coverage metadata.
 * The LLM-driven gatherer uses these to understand the incident shape.
 */

export interface AlertTimeline {
  firstAlert: string // ISO timestamp
  latestAlert: string // ISO timestamp
  durationMs: number
  alertsPerMinute: number
  escalationPattern: "stable" | "escalating" | "intermittent"
}

export interface ServiceTopologyHint {
  primaryService: string | null
  relatedServices: string[]
  affectedServiceCount: number
}

export interface SeverityEscalation {
  initialSeverity: string
  currentSeverity: string
  escalated: boolean
  escalationTime?: string // ISO timestamp of first escalation
}

export interface ScoutEnrichments {
  timeline: AlertTimeline | null
  topology: ServiceTopologyHint | null
  escalation: SeverityEscalation | null
}
