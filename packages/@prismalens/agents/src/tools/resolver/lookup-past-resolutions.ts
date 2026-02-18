/**
 * Resolver tool: Look up past incident resolution steps.
 *
 * Read-only precedent tool for the resolver subgraph.
 * Retrieves how similar past incidents were resolved.
 *
 * Stub implementation — Phase 7 adds real lookup.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * Look up how past incidents with similar root causes were resolved.
 */
export const lookupPastResolutions = tool(
  async (input) => {
    return JSON.stringify({
      resolutions: [],
      message: `Stub: would look up past resolutions for "${input.rootCause}"`,
    })
  },
  {
    name: "lookup_past_resolutions",
    description:
      "Retrieve how similar past incidents were resolved, including resolution steps and time-to-resolve",
    schema: z.object({
      rootCause: z.string().describe("Root cause description to search for"),
      service: z
        .string()
        .optional()
        .describe("Filter by service name"),
      limit: z.number().optional().default(5).describe("Max resolutions to return"),
    }),
  },
)
