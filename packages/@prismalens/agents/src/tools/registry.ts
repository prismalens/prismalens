/**
 * ToolRegistry — scoping tools per agent and loading skills.
 *
 * Manages which tools are available to which agent,
 * loads skills based on integration availability.
 */

import type { StructuredToolInterface } from "@langchain/core/tools"
import type { IntegrationContext } from "../types/contexts.js"
import type { Skill, ToolBundle, ToolCategory } from "./types.js"

/**
 * ToolRegistry manages tool scoping per agent.
 *
 * Stub implementation — will be fleshed out when skills and MCP are implemented.
 */
export class ToolRegistry {
  private skills: Skill[] = []
  private bundles: Map<string, ToolBundle> = new Map()

  /**
   * Register a skill in the registry.
   */
  registerSkill(skill: Skill): void {
    this.skills = [...this.skills, skill]
  }

  /**
   * Register a tool bundle in the registry.
   */
  registerBundle(bundle: ToolBundle): void {
    this.bundles.set(bundle.name, bundle)
  }

  /**
   * Get tools for a specific agent, filtered by category.
   */
  getToolsForAgent(
    _agentName: string,
    _categories: ToolCategory[],
  ): StructuredToolInterface[] {
    // Stub: return empty array until skills are implemented
    return []
  }

  /**
   * Get all registered skills.
   */
  getSkills(): Skill[] {
    return [...this.skills]
  }

  /**
   * Load skills based on available integrations.
   */
  loadFromIntegrations(_integrations: IntegrationContext[]): void {
    // Stub: will call loadSkills() from tools/skills/index.ts
  }

  /**
   * Get all tools across all registered bundles.
   */
  getAllTools(): StructuredToolInterface[] {
    return Array.from(this.bundles.values()).flatMap(
      (bundle) => bundle.tools,
    )
  }
}
