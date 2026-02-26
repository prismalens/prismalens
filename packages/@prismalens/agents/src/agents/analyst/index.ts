/**
 * Analyst agent — createDeepAgent wrapper for root cause analysis.
 *
 * Receives gathered data from scout + gatherer, forms competing root cause
 * hypotheses, evaluates evidence, and produces confidence-scored results.
 *
 * Architecture: createDeepAgent node (like gatherer). No custom tools —
 * pure LLM reasoning. Tools (source control, sandbox) will be added later.
 *
 * The methodology SKILL.md provides analysis instructions via deep agent
 * skills system. All evidence is currently inferred (verified: false).
 * When verification tools are added, tool-produced evidence will be
 * marked verified: true and weighted more heavily by the scoring formula.
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
import { AnalystOutputSchema } from "../../tools/schemas.js"
import { createDeepAgentConfig } from "../../config/deep-agent-defaults.js"
import { analystPrompt } from "./prompt.js"
import { formatGatheredDataSummary, formatSimilarIncidents } from "./format.js"
import { extractAnalystResults } from "./extract.js"
import type { InvestigationState } from "../../types/state.js"
import type { IntegrationContext, SimilarIncidentMatch } from "../../types/contexts.js"

export { analystPrompt, ANALYST_PROMPT } from "./prompt.js"
export { scoreHypothesis, extractAnalystResults } from "./extract.js"
export { formatGatheredDataSummary, formatSimilarIncidents } from "./format.js"

/**
 * Create the analyst function node.
 *
 * Loads skills + builds tool maps at build time (closure). Creates a
 * createDeepAgent per invocation since LLM config and systemPrompt
 * depend on runtime state.
 *
 * @param integrations - Active integration contexts for skill loading
 * @param mcpTools - Additional MCP tools to bind (future: source control, sandbox)
 */
export function createAnalystNode(
  integrations: IntegrationContext[],
  mcpTools: StructuredToolInterface[] = [],
) {
  // Build-time: load skill metadata, build tool maps, create config
  const agentConfig = createDeepAgentConfig("analyst")
  const skills = loadSkillMetadata(integrations, "analyst")
  const skillAllowedTools = buildSkillAllowedToolsMap(skills)

  return async (
    state: InvestigationState,
    config?: RunnableConfig,
  ): Promise<Partial<InvestigationState>> => {
    // Per-invocation: fresh loaded skills tracker + middleware
    const loadedSkillNames: string[] = []
    const middleware = agentConfig.createMiddleware(loadedSkillNames, skillAllowedTools)

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
        tools: [...mcpTools],
        systemPrompt,
        skills: agentConfig.skillsSources,
        backend: agentConfig.backend,
        middleware,
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

      return {
        ...extractAnalystResults(result, state),
        skillsLoaded: loadedSkillNames,
      }
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
