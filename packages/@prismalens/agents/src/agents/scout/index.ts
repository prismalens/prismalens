/**
 * Scout agent — simple deterministic function node.
 *
 * Fetches incident + alerts via DataProvider, then does a parallel
 * initial data sweep (logs, commits, deployments) using individual tools.
 *
 * No LLM, no subgraph, no ToolNode. Simple closure over DataProvider.
 *
 * Stub implementation — Phase 2 adds real data fetching.
 */

import type { DataProvider } from "../../providers/data-provider.js"
import type { InvestigationState } from "../../types/state.js"

/**
 * Create the scout function node.
 *
 * Phase 1 stub: returns minimal state update with mock data from DataProvider.
 * Phase 2: adds parallel data sweep via Promise.all with individual tool imports.
 */
export function createScoutNode(dataProvider: DataProvider) {
  return async (
    state: InvestigationState,
  ): Promise<Partial<InvestigationState>> => {
    // Phase 1: Fetch core data via DataProvider
    const incident = await dataProvider.fetchIncident(state.incidentId)
    const alertResponse = await dataProvider.fetchAlerts({
      incidentId: state.incidentId,
    })

    if (!incident) {
      return {
        errors: [`Incident not found: ${state.incidentId}`],
        phase: "completed",
      }
    }

    // Phase 2 will add: parallel data sweep via Promise.all
    // const [logs, commits, deployments] = await Promise.all([...])

    return {
      incident,
      alerts: alertResponse.alerts,
      phase: "gathering",
      gatheredData: {
        coverage: {
          sourcesQueried: [],
          sourcesWithData: [],
          dataGaps: ["logs", "commits", "deployments"],
        },
      },
    }
  }
}
