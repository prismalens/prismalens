/**
 * Analyst agent — createDeepAgent wrapper for root cause analysis.
 *
 * Receives gathered data from scout + gatherer, forms competing root cause
 * hypotheses, evaluates evidence, and produces confidence-scored results.
 *
 * Has workspace access (execute, grep, read_file) for code investigation:
 * - Clone repositories into workspace
 * - Search code for error patterns
 * - Write and run analysis scripts
 * - Tool-produced evidence is marked verified: true
 */

import { createDeepAgent } from "deepagents"
import { toolStrategy } from "langchain"
import type { BaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { BackendProtocol } from "deepagents"
import { createLLM } from "../../llm/factory.js"
import { AnalystOutputSchema } from "../../tools/schemas.js"
import { analystPrompt } from "./prompt.js"
import { formatGatheredDataSummary, formatSimilarIncidents } from "./format.js"
import { extractAnalystResults } from "./extract.js"
import type { InvestigationState } from "../../types/state.js"
import type { SimilarIncidentMatch } from "../../types/contexts.js"

/**
 * Dependencies for creating the analyst node.
 */
export interface AnalystNodeDeps {
  backend: BackendProtocol
  httpRequestTool: StructuredToolInterface
  mcpTools: StructuredToolInterface[]
  skills: string[]
}

/**
 * Create the analyst function node.
 *
 * @param deps - Backend, tools, and skills paths from the investigation graph
 */
export function createAnalystNode(deps: AnalystNodeDeps) {
  const { backend, httpRequestTool, mcpTools, skills } = deps

  return async (
    state: InvestigationState,
    config?: RunnableConfig,
  ): Promise<Partial<InvestigationState>> => {
    // Extract similar incidents from gathered data
    const similarIncidents = (state.gatheredData?.similarIncidents ?? []) as SimilarIncidentMatch[]

    // Build system prompt with full investigation context
    const systemPrompt = analystPrompt({
      incidentTitle: state.incident?.title ?? "Unknown",
      severity: state.incident?.severity ?? "medium",
      gatheredDataSummary: formatGatheredDataSummary(state.gatheredData ?? {}),
      similarIncidents: formatSimilarIncidents(similarIncidents),
    })

    try {
      const agent = createDeepAgent({
        model: createLLM(state.config.llm),
        tools: [httpRequestTool, ...mcpTools],
        systemPrompt,
        skills,
        backend,
        responseFormat: toolStrategy(AnalystOutputSchema),
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

      return extractAnalystResults(result, state)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        lastAgentResponse: {
          agent: "analyst",
          status: "blocked",
          summary: `Analyst failed: ${message}`,
          recommendation: "gatherer",
          reasoning: "Analyst encountered an error. Gatherer should retry with available data.",
        },
        errors: [`analyst failed: ${message}`],
      }
    }
  }
}
