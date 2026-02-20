/**
 * Severity mapping utilities
 */

import type { Severity } from "@prismalens/contracts/schemas"

/**
 * Map a severity string to a standard severity level
 */
export function mapSeverity(severity?: string): Severity {
  if (!severity) return "low"

  const normalized = severity.toLowerCase()

  if (normalized.includes("critical") || normalized.includes("p1") || normalized.includes("sev1")) {
    return "critical"
  }
  if (normalized.includes("high") || normalized.includes("p2") || normalized.includes("sev2")) {
    return "high"
  }
  if (normalized.includes("medium") || normalized.includes("p3") || normalized.includes("sev3")) {
    return "medium"
  }
  if (normalized.includes("low") || normalized.includes("p4") || normalized.includes("sev4")) {
    return "low"
  }
  if (normalized.includes("info") || normalized.includes("informational")) {
    return "info"
  }

  return "low"
}
