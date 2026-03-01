/**
 * Resolver agent — createDeepAgent wrapper for remediation.
 *
 * Receives hypotheses from the analyst + gathered data, and produces
 * actionable remediation recommendations grounded in precedent.
 *
 * Has workspace access (execute, grep, read_file) for validation:
 * - Write and run test scripts to verify proposed fixes
 * - Clone repos and apply patches to test feasibility
 * - Run project test suites to check for regressions
 */

import { createDeepAgent } from "deepagents"
import { toolStrategy } from "langchain"
import type { BaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import { resolveAgentLLM } from "../../llm/factory.js"
import { ResolverOutputSchema } from "../../tools/schemas.js"
import { resolverPrompt } from "./prompt.js"
import { formatHypothesesContext, formatSimilarResolutions } from "./format.js"
import { formatGatheredDataSummary } from "../analyst/format.js"
import { extractResolverResults } from "./extract.js"
import type { InvestigationState } from "../../types/state.js"
import type { SimilarIncidentMatch } from "../../types/contexts.js"
import type { AgentNodeDeps } from "../types.js"

/**
 * Create the resolver function node.
 *
 * @param deps - Backend, tools, and skills paths from the investigation graph
 */
export function createResolverNode(deps: AgentNodeDeps) {
  const { backend, tools, skills } = deps

  return async (
    state: InvestigationState,
    config?: RunnableConfig,
  ): Promise<Partial<InvestigationState>> => {
    // Extract similar incidents from gathered data
    const similarIncidents = (state.gatheredData?.similarIncidents ??
      []) as SimilarIncidentMatch[]

    // Build system prompt with full investigation context
    const systemPrompt = resolverPrompt({
      incidentTitle: state.incident?.title ?? "Unknown",
      severity: state.incident?.severity ?? "medium",
      hypothesesContext: formatHypothesesContext(state.hypotheses ?? []),
      similarResolutions: formatSimilarResolutions(similarIncidents),
      gatheredDataSummary: formatGatheredDataSummary(
        state.gatheredData ?? {},
      ),
    })

    try {
      const agent = createDeepAgent({
        model: resolveAgentLLM(state.config.llm, state.config.agentOverrides?.["resolver"]),
        tools,
        systemPrompt,
        skills,
        backend,
        responseFormat: toolStrategy(ResolverOutputSchema),
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

      return extractResolverResults(result, state)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        lastAgentResponse: {
          agent: "resolver",
          status: "blocked",
          summary: `Resolver failed: ${message}`,
          recommendation: "__end__",
          reasoning:
            "Resolver encountered an error. Investigation should complete with available data.",
        },
        errors: [`resolver failed: ${message}`],
      }
    }
  }
}
