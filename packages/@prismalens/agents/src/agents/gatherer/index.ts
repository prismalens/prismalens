/**
 * Gatherer agent — createDeepAgent wrapper with skill-based progressive tool disclosure.
 *
 * Wraps createDeepAgent in a function node. The deep agent uses SKILL.md files
 * for progressive content disclosure and ToolGatingMiddleware for tool access
 * enforcement. Tools are hidden until the agent reads the corresponding SKILL.md.
 *
 * Flow:
 * 1. Built-in skills middleware injects skill summaries into system prompt
 * 2. ToolGatingMiddleware hides all gated tools initially
 * 3. Agent reads SKILL.md via backend → ToolGatingMiddleware unlocks those tools
 * 4. Agent uses unlocked tools → results extracted into gatheredData
 */

import { createDeepAgent } from "deepagents"
import { toolStrategy } from "langchain"
import { isToolMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { createLLM } from "../../llm/factory.js"
import {
  loadSkillMetadata,
  buildSkillAllowedToolsMap,
  buildToolsFromIntegrations,
} from "../../tools/skills/index.js"
import { GathererSummarySchema } from "../../tools/schemas.js"
import type { GathererSummary } from "../../tools/schemas.js"
import { gathererPrompt } from "./prompt.js"
import { createDeepAgentConfig } from "../../config/deep-agent-defaults.js"
import type { InvestigationState, GatheredData } from "../../types/state.js"
import type { IntegrationContext } from "../../types/contexts.js"

export { GathererStateAnnotation } from "./state.js"
export type { GathererState } from "./state.js"
export { gathererPrompt, GATHERER_PROMPT } from "./prompt.js"

/**
 * Array-typed fields of GatheredData that tools can populate.
 * The `coverage` and `metrics`/`changeEvents` fields are NOT tool-populated:
 * - `coverage` is set by the scout node
 * - `metrics` and `changeEvents` are populated by the scout via DataProvider
 */
type ToolPopulatedField = "logs" | "commits" | "deployments" | "codeSearchResults" | "similarIncidents"

/**
 * Static map from tool name to GatheredData field and expected data key.
 * Adding a new tool is a single line addition.
 */
const TOOL_DATA_MAP: Record<string, { field: ToolPopulatedField; dataKey: string }> = {
  search_logs:                { field: "logs",              dataKey: "logs" },
  analyze_log_patterns:       { field: "logs",              dataKey: "patterns" },
  search_code:                { field: "codeSearchResults", dataKey: "results" },
  get_file_content:           { field: "codeSearchResults", dataKey: "content" },
  get_recent_commits:         { field: "commits",           dataKey: "commits" },
  get_deployment_history:     { field: "deployments",       dataKey: "deployments" },
  search_similar_resolutions: { field: "similarIncidents",  dataKey: "resolutions" },
  lookup_runbook:             { field: "similarIncidents",  dataKey: "runbook" },
}

/**
 * Safely parse JSON from tool message content.
 * Handles both string and pre-parsed object content.
 */
function safeJsonParse(content: unknown): Record<string, unknown> | null {
  if (content != null && typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>
  }
  if (typeof content !== "string") return null
  try {
    const parsed = JSON.parse(content)
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * Append data to an array-typed field of GatheredData.
 */
function appendToField(
  target: GatheredData,
  field: ToolPopulatedField,
  existing: unknown[],
  data: unknown,
): void {
  ;(target as Record<string, unknown>)[field] = Array.isArray(data)
    ? [...existing, ...data]
    : [...existing, data]
}

/**
 * Extract structured gatheredData from agent messages.
 *
 * Scans ToolMessage instances, parses content by tool name,
 * and merges additively into the existing GatheredData.
 */
export function extractGatheredData(
  messages: BaseMessage[],
  existingData: GatheredData,
): GatheredData {
  const result: GatheredData = { ...existingData }

  for (const msg of messages) {
    if (!isToolMessage(msg)) continue

    const toolName = msg.name
    if (!toolName) continue

    const mapping = TOOL_DATA_MAP[toolName]
    if (!mapping) continue

    const parsed = safeJsonParse(msg.content)
    if (!parsed) continue

    const data = parsed[mapping.dataKey]
    if (data == null) continue

    const existing = (result[mapping.field] as unknown[] | undefined) ?? []
    appendToField(result, mapping.field, existing, data)
  }

  return result
}

/**
 * Create the gatherer function node.
 *
 * Loads skills + builds tool maps at build time (closure). Creates a
 * createDeepAgent per invocation since LLM config and systemPrompt
 * depend on runtime state. ToolGatingMiddleware enforces progressive
 * tool disclosure based on which SKILL.md files the agent reads.
 *
 * @param integrations - Active integration contexts for skill loading
 * @param mcpTools - Additional MCP tools to bind alongside skill tools
 */
export function createGathererNode(
  integrations: IntegrationContext[],
  mcpTools: StructuredToolInterface[] = [],
) {
  // Build-time: load skill metadata, build tool maps, create config
  const agentConfig = createDeepAgentConfig("gatherer")
  const skills = loadSkillMetadata(integrations)
  const skillAllowedTools = buildSkillAllowedToolsMap(skills)
  const customTools = buildToolsFromIntegrations(integrations)
  const allAvailableTools = [...customTools, ...mcpTools]

  return async (
    state: InvestigationState,
    config?: RunnableConfig,
  ): Promise<Partial<InvestigationState>> => {
    // Per-invocation: fresh loaded skills tracker + middleware
    const loadedSkillNames: string[] = []
    const middleware = agentConfig.createMiddleware(loadedSkillNames, skillAllowedTools)

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
            .join("\n")}\n\nPrioritize fulfilling these requests. Use the appropriate tools to fetch this data.`
        : ""

    const systemPrompt =
      gathererPrompt({
        incidentTitle: state.incident?.title ?? "Unknown",
        severity: state.incident?.severity ?? "medium",
        existingData: existingDataFields,
        dataGaps: state.dataGaps ?? [],
      }) + targetedInstructions

    try {
      // Create agent per invocation (LLM + prompt + middleware depend on state)
      const agent = createDeepAgent({
        model: createLLM(state.config.llm),
        tools: allAvailableTools,
        systemPrompt,
        skills: agentConfig.skillsSources,
        backend: agentConfig.backend,
        middleware,
        responseFormat: toolStrategy(GathererSummarySchema),
      })

      // Invoke agent with empty messages (system prompt provides context)
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

      // Extract structured data from tool messages
      const gatheredData = extractGatheredData(result.messages, gd)

      // Merge structured response dataGaps into existing coverage
      const structuredResponse = result.structuredResponse as GathererSummary | undefined
      if (structuredResponse?.dataGaps && gatheredData.coverage) {
        gatheredData.coverage = {
          ...gatheredData.coverage,
          dataGaps: structuredResponse.dataGaps,
        }
      }

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
        gatheredData,
        skillsLoaded: loadedSkillNames,
        lastAgentResponse,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        gatheredData: gd,
        skillsLoaded: loadedSkillNames,
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
