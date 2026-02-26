/**
 * Format helpers for the resolver deep agent prompt.
 *
 * Transforms hypotheses, similar incidents, and gathered data into
 * LLM-readable context injected into the resolver system prompt.
 */

import type { Hypothesis } from "../../types/results.js"
import type { SimilarIncidentMatch } from "../../types/contexts.js"

/**
 * Format analyst hypotheses for the resolver prompt.
 * Filters to confidence > 0.3 and shows category, confidence, reasoning.
 */
export function formatHypothesesContext(hypotheses: Hypothesis[]): string {
  const relevant = hypotheses.filter((h) => h.confidence > 0.3)

  if (relevant.length === 0) {
    return "No high-confidence hypotheses available. The analyst was unable to identify a clear root cause."
  }

  return relevant
    .map((h, i) => {
      const parts: string[] = []
      parts.push(
        `**${i + 1}. ${h.description}** (${(h.confidence * 100).toFixed(0)}% confidence)`,
      )
      if (h.category) parts.push(`   Category: ${h.category}`)
      if (h.reasoning) parts.push(`   Reasoning: ${h.reasoning}`)

      const supporting = h.evidence.filter(
        (e) => e.metadata?.direction === "supporting",
      )
      const contradicting = h.evidence.filter(
        (e) => e.metadata?.direction === "contradicting",
      )
      if (supporting.length > 0) {
        parts.push(
          `   Supporting evidence: ${supporting.map((e) => e.description).join("; ")}`,
        )
      }
      if (contradicting.length > 0) {
        parts.push(
          `   Contradicting evidence: ${contradicting.map((e) => e.description).join("; ")}`,
        )
      }

      return parts.join("\n")
    })
    .join("\n\n")
}

/**
 * Format similar incidents focusing on resolution details.
 * Emphasizes rootCause, resolution steps, postmortem learnings, and TTR.
 */
export function formatSimilarResolutions(
  incidents: SimilarIncidentMatch[],
): string {
  const withResolution = incidents.filter(
    (inc) => inc.rootCause ?? inc.resolution ?? inc.postmortemSummary,
  )

  if (withResolution.length === 0) {
    return "No similar past incidents with resolution data found."
  }

  return withResolution
    .map((inc, i) => {
      const parts: string[] = []
      parts.push(
        `**${i + 1}. ${inc.title}**${inc.number ? ` (INC-${inc.number})` : ""}`,
      )

      if (inc.rootCause) parts.push(`   Root cause: ${inc.rootCause}`)
      if (inc.rootCauseCategory)
        parts.push(`   Category: ${inc.rootCauseCategory}`)
      if (inc.resolution) parts.push(`   Resolution: ${inc.resolution}`)
      if (inc.postmortemSummary)
        parts.push(`   Postmortem: ${inc.postmortemSummary}`)
      if (inc.timeToResolve != null) {
        parts.push(`   Time to resolve: ${formatDuration(inc.timeToResolve)}`)
      }
      if (inc.severity) parts.push(`   Severity: ${inc.severity}`)

      return parts.join("\n")
    })
    .join("\n\n")
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}
