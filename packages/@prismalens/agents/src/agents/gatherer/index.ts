/**
 * Gatherer agent — createDeepAgent wrapper for data collection.
 *
 * Uses http_request tool for API calls and workspace backend (execute, grep,
 * read_file) for programmatic data processing. No custom middleware — the
 * deepagents library handles progressive disclosure via SKILL.md files.
 *
 * Flow:
 * 1. Agent reads SKILL.md files to learn about available integrations
 * 2. Agent calls http_request to fetch data from external APIs
 * 3. Agent optionally writes scripts and runs them via execute for batch operations
 * 4. Structured response (GathererSummarySchema) captures what was gathered
 */

import { createDeepAgent } from "deepagents"
import { toolStrategy } from "langchain"
import type { BaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import { resolveAgentLLM } from "../../llm/factory.js"
import { GathererSummarySchema } from "../../tools/schemas.js"
import type { GathererSummary } from "../../tools/schemas.js"
import { gathererPrompt } from "./prompt.js"
import type { InvestigationState } from "../../types/state.js"
import type { AgentNodeDeps } from "../types.js"

/**
 * Create the gatherer function node.
 *
 * @param deps - Backend, tools, and skills paths from the investigation graph
 */
export function createGathererNode(deps: AgentNodeDeps) {
  const { backend, tools, skills } = deps

  return async (
    state: InvestigationState,
    config?: RunnableConfig,
  ): Promise<Partial<InvestigationState>> => {
    // Build systemPrompt from incident context
    const gd = state.gatheredData ?? {}
    const existingDataFields: string[] = []
    if (gd.logs?.length) existingDataFields.push("logs")
    if (gd.commits?.length) existingDataFields.push("commits")
    if (gd.deployments?.length) existingDataFields.push("deployments")
    if (gd.codeSearchResults?.length) existingDataFields.push("code search results")
    if (gd.similarIncidents?.length) existingDataFields.push("similar incidents")
    if (gd.changeEvents?.length) existingDataFields.push("change events")

    // Build targeted gathering instructions from analyst's data requests
    const dataRequests = state.lastAgentResponse?.dataRequests ?? []
    const targetedInstructions =
      dataRequests.length > 0
        ? `\n\n## Targeted Data Requests\nThe analyst has specifically requested:\n${dataRequests
            .map(
              (r, i) =>
                `${i + 1}. [${r.priority}] ${r.source}${r.targets ? ` for ${r.targets.join(", ")}` : ""}${r.query ? ` — query: "${r.query}"` : ""}\n   Reason: ${r.reasoning}`,
            )
            .join("\n")}\n\nPrioritize fulfilling these requests. Use http_request or execute scripts to fetch this data.`
        : ""

    const systemPrompt =
      gathererPrompt({
        incidentTitle: state.incident?.title ?? "Unknown",
        severity: state.incident?.severity ?? "medium",
        existingData: existingDataFields,
        dataGaps: state.dataGaps ?? [],
      }) + targetedInstructions

    try {
      const agent = createDeepAgent({
        model: resolveAgentLLM(state.config.llm, state.config.agentOverrides?.["gatherer"]),
        tools,
        systemPrompt,
        skills,
        backend,
        responseFormat: toolStrategy(GathererSummarySchema),
      })

      // Two-step assertion avoids TS2589 "excessively deep" from createDeepAgent generics
      const invokeAgent = agent as unknown as {
        invoke(
          input: { messages: BaseMessage[] },
          config?: { signal?: AbortSignal },
        ): Promise<{ messages: BaseMessage[]; structuredResponse?: unknown }>
      }
      const result = await invokeAgent.invoke(
        { messages: [] },
        config ? { signal: config.signal } : undefined,
      )

      // Structured response provides the gatherer's summary
      const structuredResponse = result.structuredResponse as GathererSummary | undefined

      // Build self-assessment from structured response
      const lastAgentResponse = {
        agent: "gatherer" as const,
        status:
          structuredResponse && structuredResponse.dataGaps.length > 0
            ? ("needs_more_data" as const)
            : ("completed" as const),
        summary: structuredResponse?.dataSummary ?? "Data gathering completed",
        recommendation: "analyst" as const,
        reasoning:
          structuredResponse?.coverageAssessment ??
          "Data collected, analyst should review",
      }

      return {
        gatheredData: gd,
        lastAgentResponse,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        gatheredData: gd,
        lastAgentResponse: {
          agent: "gatherer" as const,
          status: "blocked" as const,
          summary: `Gatherer failed: ${message}`,
          recommendation: "analyst" as const,
          reasoning:
            "Gatherer encountered an error. Analyst should proceed with available data.",
        },
        errors: [`gatherer failed: ${message}`],
      }
    }
  }
}
