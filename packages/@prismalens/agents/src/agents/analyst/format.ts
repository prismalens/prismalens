/**
 * Format helpers for the analyst deep agent prompt.
 *
 * Transforms gathered data and similar incidents into LLM-readable
 * summaries injected into the analyst system prompt.
 */

import type { GatheredData } from "../../types/state.js"
import type { SimilarIncidentMatch } from "../../types/contexts.js"

/**
 * Summarize gathered data into a structured overview for the analyst.
 * Each data source gets a short section with count and a sample of entries.
 */
export function formatGatheredDataSummary(data: GatheredData): string {
  const sections: string[] = []

  if (data.logs?.length) {
    sections.push(`### Logs (${data.logs.length} entries)\n${summarizeItems(data.logs, 5)}`)
  }

  if (data.commits?.length) {
    sections.push(`### Commits (${data.commits.length} entries)\n${summarizeItems(data.commits, 5)}`)
  }

  if (data.deployments?.length) {
    sections.push(`### Deployments (${data.deployments.length} entries)\n${summarizeItems(data.deployments, 5)}`)
  }

  if (data.changeEvents?.length) {
    sections.push(`### Change Events (${data.changeEvents.length} entries)\n${summarizeItems(data.changeEvents, 5)}`)
  }

  if (data.codeSearchResults?.length) {
    sections.push(`### Code Search Results (${data.codeSearchResults.length} entries)\n${summarizeItems(data.codeSearchResults, 3)}`)
  }

  if (data.metrics?.length) {
    sections.push(`### Metrics (${data.metrics.length} entries)\n${summarizeItems(data.metrics, 5)}`)
  }

  if (data.coverage) {
    const cov = data.coverage
    const parts: string[] = []
    parts.push(`- Incident found: ${cov.incident.found}`)
    parts.push(`- Alerts: ${cov.alerts.fetched} fetched${cov.alerts.sampled ? " (sampled)" : ""}`)
    if (cov.changeEvents) {
      parts.push(`- Change events: ${cov.changeEvents.fetched} fetched${cov.changeEvents.sampled ? " (sampled)" : ""}`)
    }
    if (cov.similarIncidents) {
      parts.push(`- Similar incidents: ${cov.similarIncidents.fetched} fetched`)
    }
    if (cov.services.count > 0) {
      parts.push(`- Services detected: ${cov.services.detected.join(", ")}`)
    }
    parts.push(`- Data completeness: ${cov.dataCompleteness}`)
    if (cov.dataGaps.length > 0) {
      parts.push(`- Data gaps: ${cov.dataGaps.join(", ")}`)
    }
    sections.push(`### Coverage\n${parts.join("\n")}`)
  }

  if (sections.length === 0) {
    return "No gathered data available."
  }

  return sections.join("\n\n")
}

/**
 * Format similar incidents into a structured section for the analyst.
 * Includes rootCause, postmortem, and resolution info when available.
 */
export function formatSimilarIncidents(incidents: SimilarIncidentMatch[]): string {
  if (incidents.length === 0) {
    return "No similar past incidents found."
  }

  return incidents
    .map((inc, i) => {
      const parts: string[] = []
      parts.push(`**${i + 1}. ${inc.title}**${inc.number ? ` (INC-${inc.number})` : ""}`)

      if (inc.severity) parts.push(`   Severity: ${inc.severity}`)
      if (inc.rootCause) parts.push(`   Root cause: ${inc.rootCause}`)
      if (inc.rootCauseCategory) parts.push(`   Category: ${inc.rootCauseCategory}`)
      if (inc.resolution) parts.push(`   Resolution: ${inc.resolution}`)
      if (inc.postmortemSummary) parts.push(`   Postmortem: ${inc.postmortemSummary}`)
      if (inc.timeToResolve != null) {
        parts.push(`   Time to resolve: ${formatDuration(inc.timeToResolve)}`)
      }
      if (inc.tags?.length) parts.push(`   Tags: ${inc.tags.join(", ")}`)
      if (inc.description) parts.push(`   Description: ${truncate(inc.description, 200)}`)

      return parts.join("\n")
    })
    .join("\n\n")
}

/**
 * Summarize items as compact JSON-ish text, truncating to `max` entries.
 */
function summarizeItems(items: unknown[], max: number): string {
  const displayed = items.slice(0, max)
  const lines = displayed.map((item) => {
    const text = typeof item === "string" ? item : JSON.stringify(item)
    return `- ${truncate(text, 300)}`
  })

  if (items.length > max) {
    lines.push(`- ... and ${items.length - max} more`)
  }

  return lines.join("\n")
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + "..."
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}
