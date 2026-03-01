/**
 * Core context types for incident investigation.
 *
 * These types align with the database schema (app.prisma) and match
 * what WorkerDataProvider actually maps.
 */

import type {
  Severity,
  AlertStatus,
  IncidentStatus,
  Priority,
} from "@prismalens/contracts/schemas"

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
  severity: Severity
  status: IncidentStatus
  priority: Priority

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
  severity: Severity
  status: AlertStatus

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
 * Used in graph state where credentials must not be serialized.
 */
export interface IntegrationContext {
  id: string
  name: string
  type: string
  enabled: boolean
  config: Record<string, unknown>
}

/**
 * Integration context with decrypted credentials.
 *
 * Bridges queue service data (DB credentials) to the agents package.
 * Used at graph build time to create http_request tool + workspace env vars.
 * Never serialized to graph state or checkpoints.
 */
export interface IntegrationWithCredentials extends IntegrationContext {
  credentials: Record<string, unknown>
}

/**
 * Similar incident match from historical data.
 * Includes fields mapped by WorkerDataProvider.
 */
export interface SimilarIncidentMatch {
  incidentId: string
  title: string
  similarity: number
  rootCause?: string
  rootCauseCategory?: string
  resolution?: string
  timeToResolve?: number
  resolvedAt?: string
  matchedAlerts?: string[]
  postmortemSummary?: string

  // Extra fields mapped by consumers
  number?: number
  description?: string
  severity?: string
  tags?: string[]
  serviceId?: string
  serviceName?: string
}
