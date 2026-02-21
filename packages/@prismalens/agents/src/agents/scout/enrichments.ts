/**
 * Pure enrichment functions — compute timeline, topology, and escalation
 * from fetched alert and incident data.
 */

import type { AlertContext, IncidentContext } from "../../types/contexts.js"
import type {
  AlertTimeline,
  ServiceTopologyHint,
  SeverityEscalation,
} from "./types.js"

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? -1
}

/**
 * Compute alert timeline from a set of alerts.
 * Returns null for 0 alerts.
 */
export function computeAlertTimeline(
  alerts: AlertContext[],
): AlertTimeline | null {
  if (alerts.length === 0) return null

  const timestamps = alerts
    .map((a) => new Date(a.triggeredAt).getTime())
    .sort((a, b) => a - b)

  const firstAlert = new Date(timestamps[0]).toISOString()
  const latestAlert = new Date(timestamps[timestamps.length - 1]).toISOString()
  const durationMs = timestamps[timestamps.length - 1] - timestamps[0]

  if (alerts.length === 1) {
    return {
      firstAlert,
      latestAlert,
      durationMs: 0,
      alertsPerMinute: 0,
      escalationPattern: "stable",
    }
  }

  const durationMinutes = durationMs / 60_000
  const alertsPerMinute =
    durationMinutes > 0 ? alerts.length / durationMinutes : alerts.length

  // Escalation detection: split timespan into 3 equal windows
  const escalationPattern = detectEscalationPattern(timestamps)

  return {
    firstAlert,
    latestAlert,
    durationMs,
    alertsPerMinute: Math.round(alertsPerMinute * 100) / 100,
    escalationPattern,
  }
}

function detectEscalationPattern(
  sortedTimestamps: number[],
): AlertTimeline["escalationPattern"] {
  if (sortedTimestamps.length < 3) return "stable"

  const start = sortedTimestamps[0]
  const end = sortedTimestamps[sortedTimestamps.length - 1]
  const span = end - start

  if (span === 0) return "stable"

  const windowSize = span / 3
  const windows = [0, 0, 0]

  for (const ts of sortedTimestamps) {
    const windowIndex = Math.min(
      Math.floor((ts - start) / windowSize),
      2,
    )
    windows[windowIndex]++
  }

  // Any window with 0 alerts → intermittent
  if (windows.some((w) => w === 0)) return "intermittent"

  // Increasing counts across windows → escalating
  if (windows[0] < windows[1] && windows[1] < windows[2]) return "escalating"

  return "stable"
}

/**
 * Extract service topology hints from incident and alerts.
 * Returns null if no serviceId found anywhere.
 */
export function extractServiceTopology(
  incident: IncidentContext | null,
  alerts: AlertContext[],
): ServiceTopologyHint | null {
  const serviceCounts = new Map<string, number>()

  if (incident?.serviceId) {
    serviceCounts.set(incident.serviceId, (serviceCounts.get(incident.serviceId) ?? 0) + 1)
  }

  for (const alert of alerts) {
    if (alert.serviceId) {
      serviceCounts.set(alert.serviceId, (serviceCounts.get(alert.serviceId) ?? 0) + 1)
    }
  }

  if (serviceCounts.size === 0) return null

  // Primary = incident.serviceId if present, else most frequently seen
  let primaryService: string | null = incident?.serviceId ?? null
  if (!primaryService) {
    let maxCount = 0
    for (const [svc, count] of serviceCounts) {
      if (count > maxCount) {
        maxCount = count
        primaryService = svc
      }
    }
  }

  const allServices = [...serviceCounts.keys()]
  const relatedServices = allServices.filter((s) => s !== primaryService)

  return {
    primaryService,
    relatedServices,
    affectedServiceCount: allServices.length,
  }
}

/**
 * Compute severity escalation from alerts.
 * Returns null for < 2 alerts.
 */
export function computeSeverityEscalation(
  alerts: AlertContext[],
): SeverityEscalation | null {
  if (alerts.length < 2) return null

  const sorted = [...alerts].sort(
    (a, b) =>
      new Date(a.triggeredAt).getTime() - new Date(b.triggeredAt).getTime(),
  )

  const initialSeverity = sorted[0].severity
  let peakSeverity = initialSeverity
  let peakRank = severityRank(initialSeverity)
  let escalationTime: string | undefined

  for (const alert of sorted) {
    const rank = severityRank(alert.severity)
    if (rank > peakRank) {
      peakRank = rank
      peakSeverity = alert.severity
      escalationTime = alert.triggeredAt
    }
  }

  const escalated = peakRank > severityRank(initialSeverity)

  return {
    initialSeverity,
    currentSeverity: peakSeverity,
    escalated,
    ...(escalated && escalationTime ? { escalationTime } : {}),
  }
}
