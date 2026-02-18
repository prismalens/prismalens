/**
 * Resolver tool: Search runbook repository.
 *
 * Read-only precedent tool for the resolver subgraph.
 * Searches runbooks matching root cause category and affected service.
 *
 * Stub implementation — Phase 7 adds real search.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * Search runbook repository for relevant runbooks.
 */
export const searchRunbooks = tool(
  async (input) => {
    return JSON.stringify({
      runbooks: [],
      message: `Stub: would search runbooks for "${input.query}"`,
    })
  },
  {
    name: "search_runbooks",
    description:
      "Search runbook repository for relevant operational procedures matching the root cause",
    schema: z.object({
      query: z.string().describe("Description of the issue to find runbooks for"),
      service: z
        .string()
        .optional()
        .describe("Filter by service name"),
      category: z
        .string()
        .optional()
        .describe("Root cause category to filter by"),
      limit: z.number().optional().default(3).describe("Max runbooks to return"),
    }),
  },
)
