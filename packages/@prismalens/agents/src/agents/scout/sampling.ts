/**
 * Alert sampling — stratified by severity.
 *
 * When alerts exceed the budget, takes all critical + high first,
 * then proportionally samples medium/low/info.
 */

import type { AlertContext } from "../../types/contexts.js"

const PRIORITY_SEVERITIES = new Set(["critical", "high"])

/**
 * Sample alerts within a limit using stratified severity sampling.
 * Returns all alerts if within limit. Otherwise takes all critical/high,
 * then fills remaining budget proportionally from medium/low/info.
 */
export function sampleAlerts(
  alerts: AlertContext[],
  limit: number,
): AlertContext[] {
  if (alerts.length <= limit) return alerts

  // Split into priority (critical, high) and rest
  const priority: AlertContext[] = []
  const rest: AlertContext[] = []

  for (const alert of alerts) {
    if (PRIORITY_SEVERITIES.has(alert.severity)) {
      priority.push(alert)
    } else {
      rest.push(alert)
    }
  }

  // If priority alerts already exceed limit, take first N priority
  if (priority.length >= limit) {
    return priority.slice(0, limit)
  }

  // Fill remaining budget from rest
  const remaining = limit - priority.length
  return [...priority, ...rest.slice(0, remaining)]
}
