/**
 * ToolGatingMiddleware — enforces tool access based on loaded SKILL.md files.
 *
 * The built-in skills middleware from deepagents handles progressive content
 * disclosure (injecting skill summaries into system prompt). This middleware
 * adds ENFORCEMENT: tools listed in a skill's `allowed-tools` are hidden from
 * the LLM until the agent reads that skill's SKILL.md via the backend.
 *
 * Flow:
 * 1. wrapToolCall: detects when agent reads a SKILL.md file, tracks the skill name
 * 2. wrapModelCall: filters request.tools to only include tools from loaded skills
 *    (plus any tools not gated by any skill)
 */

import { createMiddleware } from "langchain"

/**
 * Extract skill name from a SKILL.md file path.
 *
 * Expected path pattern: .../skills/<agent>/<skillName>/SKILL.md
 * or /skills/<skillName>/SKILL.md (virtual path in backend)
 */
export function extractSkillNameFromPath(path: string): string | null {
  if (!path.endsWith("SKILL.md")) return null
  // Split and find the directory immediately before SKILL.md
  const segments = path.split("/").filter(Boolean)
  const skillMdIdx = segments.findIndex((s) => s === "SKILL.md")
  if (skillMdIdx < 1) return null
  return segments[skillMdIdx - 1] ?? null
}

/**
 * Create a ToolGatingMiddleware that enforces tool access based on loaded skills.
 *
 * @param skillAllowedTools - Map from skill name to array of tool names from allowed-tools
 * @param loadedSkillNames - Mutable array tracking which skills have been loaded (shared closure)
 */
export function createToolGatingMiddleware(
  skillAllowedTools: Map<string, string[]>,
  loadedSkillNames: string[],
) {
  // All tool names that belong to ANY skill — these are gated
  const allGatedTools = new Set(
    [...skillAllowedTools.values()].flat(),
  )

  return createMiddleware({
    name: "ToolGatingMiddleware",

    wrapModelCall: (request: any, handler: any) => {
      // Compute currently allowed tools from loaded skills
      const allowed = new Set(
        loadedSkillNames.flatMap((name) => skillAllowedTools.get(name) ?? []),
      )

      // Filter tools: keep non-gated tools + tools from loaded skills
      const visibleTools = request.tools.filter(
        (t: any) => !allGatedTools.has(t.name) || allowed.has(t.name),
      )

      return handler({ ...request, tools: visibleTools })
    },

    wrapToolCall: async (request: any, handler: any) => {
      const result = await handler(request)

      // Detect SKILL.md reads via backend read_file/read tool
      const toolName = request.toolCall.name
      if (toolName === "read_file" || toolName === "read") {
        const path = String(request.toolCall.args?.path ?? "")
        if (path.includes("/skills/") && path.endsWith("SKILL.md")) {
          const skillName = extractSkillNameFromPath(path)
          if (skillName && !loadedSkillNames.includes(skillName)) {
            loadedSkillNames.push(skillName)
          }
        }
      }

      return result
    },
  })
}
