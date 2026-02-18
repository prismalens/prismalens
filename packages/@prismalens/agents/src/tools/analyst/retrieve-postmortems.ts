/**
 * Analyst tool: Retrieve relevant postmortem writeups.
 *
 * Read-only verification tool for the analyst subgraph.
 * Fetches relevant postmortem writeups for grounding analysis.
 *
 * Stub implementation — Phase 6 adds real retrieval.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * Fetch relevant postmortem writeups for grounding analysis.
 */
export const retrievePostmortems = tool(
  async (input) => {
    return JSON.stringify({
      postmortems: [],
      message: `Stub: would retrieve postmortems for "${input.query}"`,
    })
  },
  {
    name: "retrieve_postmortems",
    description:
      "Fetch relevant postmortem writeups from past incidents for grounding root cause analysis",
    schema: z.object({
      query: z.string().describe("Description of the issue to find postmortems for"),
      category: z
        .string()
        .optional()
        .describe("Root cause category to filter by"),
      limit: z.number().optional().default(3).describe("Max postmortems to return"),
    }),
  },
)
