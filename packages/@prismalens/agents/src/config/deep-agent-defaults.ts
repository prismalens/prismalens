/**
 * Shared deep agent configuration factory.
 *
 * Creates consistent config for any deep agent (gatherer, analyst, resolver).
 * Each agent gets its own skill directory + common skills, a shared backend,
 * and the ToolGatingMiddleware.
 */

import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { FilesystemBackend } from "deepagents"
import { createToolGatingMiddleware } from "../middleware/tool-gating-middleware.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the skills directory path.
 * Located at packages/@prismalens/agents/skills/ (two levels up from src/config/)
 */
function getSkillsDir(): string {
  return resolve(__dirname, "../../skills")
}

/**
 * Create deep agent configuration for a specific agent.
 *
 * @param agentName - Agent name (e.g., "gatherer", "analyst", "resolver")
 * @returns Config object with skill sources, backend, and middleware factory
 */
export function createDeepAgentConfig(agentName: string) {
  const skillsDir = getSkillsDir()
  const commonDir = "/common/"
  const agentDir = `/${agentName}/`

  return {
    /** Skill source paths (relative to backend root) for createDeepAgent.skills */
    skillsSources: [commonDir, agentDir],

    /** FilesystemBackend rooted at skills directory — virtual mode for path containment */
    backend: new FilesystemBackend({ rootDir: skillsDir, virtualMode: true }),

    /**
     * Create middleware array for a deep agent invocation.
     *
     * @param loadedSkillNames - Mutable array tracking loaded skills (per-invocation)
     * @param skillAllowedTools - Map from skill name to allowed tool names
     */
    createMiddleware: (
      loadedSkillNames: string[],
      skillAllowedTools: Map<string, string[]>,
    ) => [createToolGatingMiddleware(skillAllowedTools, loadedSkillNames)],
  }
}
