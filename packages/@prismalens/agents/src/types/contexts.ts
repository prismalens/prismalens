/**
 * Core context types for incident investigation.
 *
 * These types align with the database schema (app.prisma) and match
 * what DirectDataProvider and WorkerDataProvider actually map.
 */

/**
 * Incident context — matches DB Incident model fields.
 * Both DataProvider implementations map to this shape.
 */
export interface IncidentContext {
  // Identity
  incidentId: string
  number: number
  title: string
  description?: string

  // Classification
  severity: "critical" | "high" | "medium" | "low"
  status:
    | "triggered"
    | "acknowledged"
    | "investigating"
    | "resolved"
    | "closed"
  priority: "p1" | "p2" | "p3" | "p4" | "p5"

  // Service context
  serviceId?: string
  serviceName?: string

  // Correlation
  correlationReason?: string
  alertCount: number

  // Timestamps (ISO strings — both consumers use .toISOString())
  triggeredAt: string
  acknowledgedAt?: string
  resolvedAt?: string

  // Metadata
  tags?: string[]
  customerImpact?: string
  affectedSystems?: string[]
}

/**
 * Alert context — matches DB Alert model fields.
 * Consumers map DB-style names (not webhook-style).
 */
export interface AlertContext {
  // Identity
  alertId: string
  title: string
  description?: string

  // Classification
  severity: "critical" | "high" | "medium" | "low"
  status: "triggered" | "acknowledged" | "resolved"

  // Source
  source?: string
  sourceUrl?: string

  // Service context
  serviceId?: string
  serviceName?: string

  // Metadata
  labels?: Record<string, string>
  tags?: string[]
  repository?: string

  // Timestamps
  triggeredAt: string

  // Raw data
  rawPayload?: Record<string, unknown>
}

/**
 * Integration context — non-sensitive configuration only.
 * Credentials are passed via RunnableConfig.configurable, NOT in state.
 */
export interface IntegrationContext {
  id: string
  name: string
  type: string
  enabled: boolean
  config: Record<string, unknown>
}

/**
 * Similar incident match from historical data.
 * Includes fields mapped by both DirectDataProvider and WorkerDataProvider.
 */
export interface SimilarIncidentMatch {
  incidentId: string
  title: string
  similarity: number
  rootCause?: string
  resolution?: string
  timeToResolve?: number
  resolvedAt?: string
  matchedAlerts?: string[]

  // Extra fields mapped by consumers
  number?: number
  description?: string
  severity?: string
  tags?: string[]
  serviceId?: string
  serviceName?: string
}
