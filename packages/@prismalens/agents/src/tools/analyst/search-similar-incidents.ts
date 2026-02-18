/**
 * Analyst tool: Search similar past incidents via RAG.
 *
 * Read-only verification tool for the analyst subgraph.
 * Searches past incidents and postmortems for pattern matching.
 *
 * Stub implementation — Phase 6 adds real RAG implementation.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * Search past incidents and postmortems for similar patterns.
 */
export const searchSimilarIncidents = tool(
  async (input) => {
    return JSON.stringify({
      incidents: [],
      message: `Stub: would search similar incidents for "${input.query}"`,
    })
  },
  {
    name: "search_similar_incidents",
    description:
      "Search past incidents and postmortems for similar patterns, useful for hypothesis validation",
    schema: z.object({
      query: z.string().describe("Description of the incident pattern to search for"),
      severity: z
        .string()
        .optional()
        .describe("Filter by severity level"),
      service: z
        .string()
        .optional()
        .describe("Filter by service name"),
      limit: z.number().optional().default(5).describe("Max incidents to return"),
    }),
  },
)
