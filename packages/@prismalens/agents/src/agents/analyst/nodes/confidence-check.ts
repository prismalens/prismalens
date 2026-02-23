/**
 * Analyst node: Structured confidence scoring.
 *
 * Deterministic node — no LLM guessing. Uses structured scoring:
 * - Temporal correlation score
 * - Evidence ratio (supporting / total)
 * - Counter-evidence penalty
 * - Precedent match score
 *
 * Routes: HIGH confidence → END, LOW + verifiable → evaluate_evidence loop,
 * LOW + needs more data → END (writes dataGaps to state).
 *
 * Stub implementation — Phase 6 adds real confidence scoring.
 * Phase 5A: Produces self-assessment with targeted data requests.
 */

import type { AnalystState } from "../state.js"
import type { DataRequest } from "../../../types/state.js"

/**
 * Confidence check node.
 *
 * Stub: promotes working hypotheses to final output and produces
 * a self-assessment with targeted data requests filtered by available sources.
 */
export async function confidenceCheck(
  state: AnalystState,
): Promise<Partial<AnalystState>> {
  // Extract affected services from incident + alerts
  const services = [
    ...new Set(
      [
        state.incident?.serviceName,
        ...(state.alerts ?? []).map((a) => a.serviceName),
      ].filter(Boolean),
    ),
  ] as string[]

  // Check what data sources are actually available
  const availableSources = new Set(
    (state.availableDataSources ?? []).map((ds) => ds.source),
  )

  const hasLogs =
    state.gatheredData?.logs &&
    (state.gatheredData.logs as unknown[]).length > 0
  const hasCommits =
    state.gatheredData?.commits &&
    (state.gatheredData.commits as unknown[]).length > 0

  const dataRequests: DataRequest[] = []

  // Only request logs if log source is available
  if (!hasLogs && services.length > 0 && availableSources.has("logs")) {
    dataRequests.push({
      source: "logs",
      targets: services,
      priority: "required",
      reasoning:
        "Need log data from affected services to identify error patterns",
    })
  }

  // Only request commits if that source is available
  if (!hasCommits && services.length > 0 && availableSources.has("commits")) {
    dataRequests.push({
      source: "commits",
      targets: services,
      priority: "nice_to_have",
      reasoning: "Recent code changes may correlate with the incident",
    })
  }

  // Only request runbooks if precedent source is available
  if (services.length > 0 && availableSources.has("runbooks")) {
    dataRequests.push({
      source: "runbooks",
      targets: services,
      priority: "nice_to_have",
      reasoning: "Check if operational runbooks exist for affected services",
    })
  }

  const needsMoreData = dataRequests.length > 0

  return {
    hypotheses: state.workingHypotheses,
    needsMoreData,
    dataGaps: dataRequests.map((r) => r.source),
    lastAgentResponse: {
      agent: "analyst",
      status: needsMoreData ? "needs_more_data" : "completed",
      summary:
        `Stub analysis: ${state.workingHypotheses.length} hypotheses formed. ` +
        `Available sources: ${[...availableSources].join(", ") || "none"}`,
      dataRequests: needsMoreData ? dataRequests : undefined,
      recommendation: needsMoreData ? "gatherer" : "resolver",
      reasoning: needsMoreData
        ? `Need data from external sources: ${dataRequests.map((r) => r.source).join(", ")}`
        : "Analysis complete (or no data sources available), ready for recommendations",
    },
  }
}
