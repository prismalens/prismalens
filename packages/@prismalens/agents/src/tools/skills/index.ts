/**
 * Skill loader — loads skills based on available integrations.
 *
 * Skills auto-activate when their required integrations are configured.
 * Phase 1: Returns stubs. Phase 3+: Returns real provider implementations.
 */

import type { IntegrationContext } from "../../types/contexts.js"
import type { Skill } from "../types.js"
import { logSkill } from "./log.js"
import { codeSkill } from "./code.js"
import { changeSkill } from "./change.js"
import { precedentSkill } from "./precedent.js"

/**
 * Check if any integration of the given types is available and enabled.
 */
function hasIntegration(
  integrations: IntegrationContext[],
  ...types: string[]
): boolean {
  return integrations.some(
    (int) => types.includes(int.type) && int.enabled,
  )
}

/**
 * Load skills based on available integrations.
 *
 * - logSkill: Always available (logs are fundamental)
 * - codeSkill + changeSkill: Requires GitHub or GitLab integration
 * - precedentSkill: Requires runbook or Confluence integration
 */
export function loadSkills(integrations: IntegrationContext[]): Skill[] {
  const skills: Skill[] = [logSkill]

  if (hasIntegration(integrations, "github", "gitlab")) {
    skills.push(codeSkill, changeSkill)
  }

  if (hasIntegration(integrations, "runbook", "confluence")) {
    skills.push(precedentSkill)
  }

  return skills
}
