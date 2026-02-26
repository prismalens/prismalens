/**
 * Skill loader — loads SKILL.md metadata and builds tool maps.
 *
 * Uses deepagents `listSkills` and `parseSkillMetadata` to read SKILL.md files
 * from the skills/ directory. Filters by requiredIntegrations and builds the
 * tool map used by ToolGatingMiddleware.
 */

import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { listSkills } from "deepagents"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { IntegrationContext } from "../../types/contexts.js"
import type { DataRequest, AvailableDataSource } from "../../types/state.js"
import type { PrismaLensSkillMetadata } from "../types.js"
import { searchLogs, analyzeLogPatterns } from "./log.js"
import { searchCode, getFileContent } from "./code.js"
import { getRecentCommits, getDeploymentHistory } from "./change.js"
import { searchSimilarResolutions, lookupRunbook } from "./precedent.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the skills directory for a given agent.
 * Located at packages/@prismalens/agents/skills/{agentName}/
 */
function getSkillsDir(agentName: string): string {
  return resolve(__dirname, `../../../skills/${agentName}`)
}

/**
 * Static map from tool name to tool instance.
 * Used by buildToolsFromIntegrations to resolve tool names from SKILL.md
 * `allowed-tools` into actual StructuredToolInterface instances.
 */
const TOOL_REGISTRY: Record<string, StructuredToolInterface> = {
  search_logs: searchLogs,
  analyze_log_patterns: analyzeLogPatterns,
  search_code: searchCode,
  get_file_content: getFileContent,
  get_recent_commits: getRecentCommits,
  get_deployment_history: getDeploymentHistory,
  search_similar_resolutions: searchSimilarResolutions,
  lookup_runbook: lookupRunbook,
}

/**
 * Check if any integration of the given types is available and enabled.
 */
function hasIntegration(
  integrations: IntegrationContext[],
  ...types: string[]
): boolean {
  if (types.length === 0) return true // no requirement = always available
  return integrations.some(
    (int) => types.includes(int.type) && int.enabled,
  )
}

/**
 * Load skill metadata from SKILL.md files, filtered by available integrations.
 *
 * Reads SKILL.md files from the agent's skills directory using deepagents
 * `listSkills`, parses `allowed-tools` and `metadata.requiredIntegrations`,
 * and returns only skills whose required integrations are satisfied.
 *
 * @param integrations - Active integration contexts for filtering
 * @param agentName - Agent name to resolve skills directory (default: "gatherer")
 * @returns Array of PrismaLensSkillMetadata for available skills
 */
export function loadSkillMetadata(
  integrations: IntegrationContext[],
  agentName = "gatherer",
): PrismaLensSkillMetadata[] {
  const skillsDir = getSkillsDir(agentName)
  const rawSkills = listSkills({ projectSkillsDir: skillsDir })

  return rawSkills
    .map((skill) => {
      const allowedToolsStr = (skill.allowedTools ?? "").trim()
      const parsedAllowedTools = allowedToolsStr
        .split(/\s+/)
        .filter(Boolean)

      const requiredIntegrationsStr = (skill.metadata?.requiredIntegrations ?? "").trim()
      const requiredIntegrations = requiredIntegrationsStr
        .split(/\s+/)
        .filter(Boolean)

      return {
        ...skill,
        parsedAllowedTools,
        requiredIntegrations,
      } satisfies PrismaLensSkillMetadata
    })
    .filter((skill) => hasIntegration(integrations, ...skill.requiredIntegrations))
}

/**
 * Build a map from skill name to allowed tool names.
 * Used by ToolGatingMiddleware to enforce tool access.
 */
export function buildSkillAllowedToolsMap(
  skills: PrismaLensSkillMetadata[],
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const skill of skills) {
    map.set(skill.name, skill.parsedAllowedTools)
  }
  return map
}

/** Map from skill name to data source categories it provides */
const SKILL_DATA_SOURCE_MAP: Record<
  string,
  { sources: DataRequest["source"][]; description: string }
> = {
  log: {
    sources: ["logs"],
    description: "Application and infrastructure logs",
  },
  code: {
    sources: ["code"],
    description: "Code search and file retrieval",
  },
  change: {
    sources: ["commits", "deployments"],
    description: "Git commits and deployment history",
  },
  precedent: {
    sources: ["runbooks"],
    description: "Runbooks and past resolutions",
  },
}

/**
 * Compute which data sources are available based on configured integrations.
 * Uses the same skill filtering as the gatherer — if a skill's required
 * integrations aren't satisfied, its data sources are unavailable.
 */
export function computeAvailableDataSources(
  integrations: IntegrationContext[],
): AvailableDataSource[] {
  const availableSkills = loadSkillMetadata(integrations)
  const sources: AvailableDataSource[] = []

  for (const skill of availableSkills) {
    const mapping = SKILL_DATA_SOURCE_MAP[skill.name]
    if (!mapping) continue

    const provider =
      skill.requiredIntegrations.length === 0
        ? "built-in"
        : (integrations.find(
            (i) => skill.requiredIntegrations.includes(i.type) && i.enabled,
          )?.type ?? "unknown")

    for (const source of mapping.sources) {
      sources.push({ source, provider, description: mapping.description })
    }
  }

  return sources
}

/**
 * Build tool instances from available skills.
 * Resolves tool names from SKILL.md `allowed-tools` to actual tool instances
 * from the TOOL_REGISTRY.
 *
 * @param integrations - Active integration contexts (used to load skill metadata)
 * @returns Array of StructuredToolInterface instances for available skills
 */
export function buildToolsFromIntegrations(
  integrations: IntegrationContext[],
): StructuredToolInterface[] {
  const skills = loadSkillMetadata(integrations)
  const toolNames = new Set(skills.flatMap((s) => s.parsedAllowedTools))
  const tools: StructuredToolInterface[] = []

  for (const name of toolNames) {
    const tool = TOOL_REGISTRY[name]
    if (tool) tools.push(tool)
  }

  return tools
}
