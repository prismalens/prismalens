/**
 * Tool system types for the agents package.
 *
 * Skills are bundles of related tools that auto-activate based on
 * configured integrations. Each skill provides tools for a specific
 * data domain (logs, code, changes, precedent).
 */

import type { StructuredToolInterface } from "@langchain/core/tools"

/**
 * Tool category for organizing tools by purpose.
 */
export type ToolCategory =
  | "log"
  | "code"
  | "change"
  | "precedent"
  | "analyst"
  | "resolver"
  | "mcp"

/**
 * A skill is a bundle of related tools with metadata.
 * Skills auto-activate based on integration availability.
 */
export interface Skill {
  name: string
  description: string
  category: ToolCategory
  tools: StructuredToolInterface[]
  requiredIntegrations: string[]
}

/**
 * Tool bundle — a named collection of tools for a specific agent.
 */
export interface ToolBundle {
  name: string
  tools: StructuredToolInterface[]
  category: ToolCategory
}
