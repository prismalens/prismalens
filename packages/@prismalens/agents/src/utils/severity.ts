/**
 * Severity Mapping Utility
 *
 * Normalizes various severity string formats (AlertManager, PagerDuty, Datadog, etc.)
 * to the standard PrismaLens severity levels.
 *
 * Shared between API (queue.service.ts) and Worker (processor.ts).
 */

export type StandardSeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * Map various severity formats to standard PrismaLens severity.
 *
 * Handles formats from: AlertManager, PagerDuty (p1-p5), Datadog, Sentry, etc.
 */
export function mapSeverity(severity: string | undefined): StandardSeverity {
	if (!severity) return "medium";

	const lower = severity.toLowerCase();

	if (lower === "critical" || lower === "crit" || lower === "p1") {
		return "critical";
	}
	if (
		lower === "high" ||
		lower === "error" ||
		lower === "p2" ||
		lower === "severe"
	) {
		return "high";
	}
	if (
		lower === "medium" ||
		lower === "warning" ||
		lower === "warn" ||
		lower === "p3"
	) {
		return "medium";
	}
	if (lower === "low" || lower === "minor" || lower === "p4") {
		return "low";
	}
	if (lower === "info" || lower === "informational" || lower === "p5") {
		return "info";
	}

	return "medium";
}
