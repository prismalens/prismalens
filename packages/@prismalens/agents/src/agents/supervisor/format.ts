/**
 * Format investigation state for the supervisor LLM.
 *
 * Compresses InvestigationState into a markdown string that the supervisor
 * can reason over to make routing decisions. Emphasizes agent self-assessments
 * and available data sources — never dumps raw gathered data.
 */

import type { InvestigationState } from "../../types/state.js"

/**
 * Format the investigation state for the supervisor LLM prompt.
 *
 * Sections (ordered by routing relevance):
 * A. Previous agent self-assessment (most important)
 * B. Available data sources
 * C. State context (supplementary)
 */
export function formatStateForSupervisor(state: InvestigationState): string {
  const sections: string[] = []

  // Section A: Previous Agent Assessment
  const assessment = state.lastAgentResponse
  if (assessment) {
    sections.push("## Previous Agent Assessment")
    sections.push(`Agent: ${assessment.agent}`)
    sections.push(`Status: ${assessment.status}`)
    sections.push(`Summary: ${assessment.summary}`)
    if (assessment.recommendation) {
      sections.push(`Recommendation: ${assessment.recommendation}`)
    }

    if (assessment.dataRequests && assessment.dataRequests.length > 0) {
      sections.push("")
      sections.push("### Data Requests")
      for (const [i, req] of assessment.dataRequests.entries()) {
        const targets = req.targets ? ` for ${req.targets.join(", ")}` : ""
        const query = req.query ? ` — query: "${req.query}"` : ""
        const timeRange = req.timeRange
          ? ` — time: ${req.timeRange.start} to ${req.timeRange.end}`
          : ""
        sections.push(
          `${i + 1}. [${req.priority}] ${req.source}${targets}${query}${timeRange}`,
        )
        sections.push(`   Reason: ${req.reasoning}`)
      }
    }

    sections.push(`\nReasoning: ${assessment.reasoning}`)
  }

  // Section B: Available Data Sources
  sections.push("")
  sections.push("## Available Data Sources")
  if (state.availableDataSources.length > 0) {
    for (const ds of state.availableDataSources) {
      sections.push(`- ${ds.source} (${ds.provider}): ${ds.description}`)
    }
  } else {
    sections.push(
      "No external data sources configured. Gatherer has no integrations.",
    )
  }

  // Section C: State Context
  sections.push("")
  sections.push("## Incident")
  if (state.incident) {
    sections.push(`Title: ${state.incident.title}`)
    sections.push(
      `Severity: ${state.incident.severity}, Status: ${state.incident.status}`,
    )
    if (state.incident.serviceName) {
      sections.push(`Service: ${state.incident.serviceName}`)
    }
  } else {
    sections.push("No incident data available")
  }

  // Data coverage (metadata only, not raw data)
  const coverage = state.gatheredData?.coverage
  if (coverage) {
    sections.push("")
    sections.push("## Data Coverage")

    const sourcesWithData: string[] = []
    if (coverage.incident.found) sourcesWithData.push("incident")
    if (coverage.alerts.fetched > 0) sourcesWithData.push("alerts")
    if (coverage.changeEvents && coverage.changeEvents.fetched > 0)
      sourcesWithData.push("changeEvents")
    if (coverage.similarIncidents && coverage.similarIncidents.fetched > 0)
      sourcesWithData.push("similarIncidents")

    sections.push(
      `Sources with data: ${sourcesWithData.join(", ") || "none"}`,
    )
    sections.push(
      `Data gaps: ${coverage.dataGaps.join(", ") || "none"}`,
    )
    sections.push(`Completeness: ${coverage.dataCompleteness}`)
  }

  // Gathered external data summary (metadata only)
  const gd = state.gatheredData ?? {}
  const externalSources: string[] = []
  if (gd.logs && (gd.logs as unknown[]).length > 0)
    externalSources.push(`logs (${(gd.logs as unknown[]).length} entries)`)
  if (gd.commits && (gd.commits as unknown[]).length > 0)
    externalSources.push(
      `commits (${(gd.commits as unknown[]).length} entries)`,
    )
  if (gd.deployments && (gd.deployments as unknown[]).length > 0)
    externalSources.push(
      `deployments (${(gd.deployments as unknown[]).length} entries)`,
    )
  if (gd.codeSearchResults && (gd.codeSearchResults as unknown[]).length > 0)
    externalSources.push(
      `code (${(gd.codeSearchResults as unknown[]).length} entries)`,
    )
  if (externalSources.length > 0) {
    sections.push(`External data gathered: ${externalSources.join(", ")}`)
  }

  // Hypotheses
  if (state.hypotheses.length > 0) {
    sections.push("")
    sections.push(`## Hypotheses (${state.hypotheses.length})`)
    for (const h of state.hypotheses) {
      sections.push(`- [${(h.confidence * 100).toFixed(0)}%] ${h.description}`)
    }
  }

  // Recommendations
  if (state.recommendations.length > 0) {
    sections.push("")
    sections.push(`## Recommendations (${state.recommendations.length})`)
    for (const r of state.recommendations) {
      sections.push(`- [${r.priority}] ${r.title}`)
    }
  }

  // Similar incidents
  const similar = state.gatheredData?.similarIncidents as
    | Array<{ similarity: number; title: string }>
    | undefined
  if (similar && similar.length > 0) {
    const best = similar.reduce((a, b) =>
      a.similarity > b.similarity ? a : b,
    )
    if (best.similarity > 0.7) {
      sections.push("")
      sections.push(
        `## Similar Incident Match: ${best.title} (${(best.similarity * 100).toFixed(0)}% match)`,
      )
    }
  }

  // Process state
  sections.push("")
  sections.push("## Process State")
  sections.push(
    `Iteration: ${state.iterations}/${state.config.maxIterations ?? 8}`,
  )
  if (state.skillsLoaded.length > 0) {
    sections.push(`Skills loaded: ${state.skillsLoaded.join(", ")}`)
  }

  return sections.join("\n")
}
