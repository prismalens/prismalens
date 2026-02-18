/**
 * Precedent skill — tools for searching past resolutions and runbooks.
 *
 * Dual exports:
 * - precedentSkill: Full skill object (used by gatherer via loadSkills())
 * - searchSimilarResolutions, lookupRunbook: Individual tools
 *
 * Stub implementation — Phase 3 adds provider implementations.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"
import type { Skill } from "../types.js"

/**
 * Search for similar past incident resolutions.
 */
export const searchSimilarResolutions = tool(
  async (input) => {
    return JSON.stringify({
      resolutions: [],
      message: `Stub: would search resolutions similar to "${input.query}"`,
    })
  },
  {
    name: "search_similar_resolutions",
    description:
      "Search for similar past incident resolutions to ground fix proposals in proven solutions",
    schema: z.object({
      query: z.string().describe("Description of the issue to find similar resolutions for"),
      category: z
        .string()
        .optional()
        .describe("Root cause category to filter by"),
      limit: z.number().optional().default(5).describe("Max resolutions to return"),
    }),
  },
)

/**
 * Look up a runbook by service or category.
 */
export const lookupRunbook = tool(
  async (input) => {
    return JSON.stringify({
      runbook: null,
      message: `Stub: would look up runbook for ${input.serviceId ?? input.category ?? "unknown"}`,
    })
  },
  {
    name: "lookup_runbook",
    description:
      "Look up operational runbooks for a service or incident category",
    schema: z.object({
      serviceId: z.string().optional().describe("Service ID to look up runbook for"),
      category: z.string().optional().describe("Incident category to search for"),
      query: z.string().optional().describe("Free-text search query"),
    }),
  },
)

/**
 * Precedent skill — bundles precedent tools with metadata.
 */
export const precedentSkill: Skill = {
  name: "precedent",
  description: "Search past resolutions and runbooks for proven solutions",
  category: "precedent",
  tools: [searchSimilarResolutions, lookupRunbook],
  requiredIntegrations: ["runbook", "confluence"],
}
