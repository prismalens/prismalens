/**
 * Tool system types for the agents package.
 *
 * Uses SkillMetadata from deepagents (agentskills.io spec) as the base type.
 * PrismaLensSkillMetadata extends it with parsed allowed-tools and
 * requiredIntegrations from SKILL.md metadata section.
 */

import type { SkillMetadata } from "deepagents"

export type { SkillMetadata }

/**
 * Extended skill metadata with PrismaLens-specific fields.
 *
 * - parsedAllowedTools: tool names from SKILL.md `allowed-tools` (space-delimited → string[])
 * - requiredIntegrations: integration types from SKILL.md `metadata.requiredIntegrations`
 */
export interface PrismaLensSkillMetadata extends Omit<SkillMetadata, "allowedTools"> {
  /** Original space-delimited allowedTools string from SKILL.md (kept for reference) */
  allowedTools?: string
  parsedAllowedTools: string[]
  requiredIntegrations: string[]
}
