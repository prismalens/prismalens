/**
 * Resolver agent — createDeepAgent wrapper for remediation.
 *
 * Receives hypotheses from the analyst + gathered data, and produces
 * actionable remediation recommendations grounded in precedent.
 *
 * Architecture: createDeepAgent node (like gatherer/analyst). No custom
 * tools — pure LLM reasoning. Tools (search_runbooks, lookup_past_resolutions)
 * will be added in a future phase and gated via SKILL.md allowed-tools.
 *
 * The remediation SKILL.md provides methodology instructions via deep agent
 * skills system. Recommendations are DB-aligned (category, urgency, effort).
 */

import { createDeepAgent } from "deepagents"
import { toolStrategy } from "langchain"
import type { BaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { createLLM } from "../../llm/factory.js"
import {
  loadSkillMetadata,
  buildSkillAllowedToolsMap,
} from "../../tools/skills/index.js"
import { ResolverOutputSchema } from "../../tools/schemas.js"
import { createDeepAgentConfig } from "../../config/deep-agent-defaults.js"
import { resolverPrompt } from "./prompt.js"
import { formatHypothesesContext, formatSimilarResolutions } from "./format.js"
import { formatGatheredDataSummary } from "../analyst/format.js"
import { extractResolverResults } from "./extract.js"
import type { InvestigationState } from "../../types/state.js"
import type { IntegrationContext, SimilarIncidentMatch } from "../../types/contexts.js"

export { resolverPrompt, RESOLVER_PROMPT } from "./prompt.js"
export { extractResolverResults } from "./extract.js"
export { formatHypothesesContext, formatSimilarResolutions } from "./format.js"

/**
 * Create the resolver function node.
 *
 * Loads skills + builds tool maps at build time (closure). Creates a
 * createDeepAgent per invocation since LLM config and systemPrompt
 * depend on runtime state.
 *
 * @param integrations - Active integration contexts for skill loading
 * @param mcpTools - Additional MCP tools to bind (future: runbook search, resolution lookup)
 */
export function createResolverNode(
  integrations: IntegrationContext[],
  mcpTools: StructuredToolInterface[] = [],
) {
  // Build-time: load skill metadata, build tool maps, create config
  const agentConfig = createDeepAgentConfig("resolver")
  const skills = loadSkillMetadata(integrations, "resolver")
  const skillAllowedTools = buildSkillAllowedToolsMap(skills)

  return async (
    state: InvestigationState,
    config?: RunnableConfig,
  ): Promise<Partial<InvestigationState>> => {
    // Per-invocation: fresh loaded skills tracker + middleware
    const loadedSkillNames: string[] = []
    const middleware = agentConfig.createMiddleware(
      loadedSkillNames,
      skillAllowedTools,
    )

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
        model: createLLM(state.config.llm),
        tools: [...mcpTools],
        systemPrompt,
        skills: agentConfig.skillsSources,
        backend: agentConfig.backend,
        middleware,
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

      return {
        ...extractResolverResults(result, state),
        skillsLoaded: loadedSkillNames,
      }
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
