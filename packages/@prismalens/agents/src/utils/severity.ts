/**
 * Severity mapping utilities
 */

/**
 * Map a severity string to a standard severity level
 */
export function mapSeverity(severity?: string): "critical" | "high" | "medium" | "low" {
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

  return "low"
}
