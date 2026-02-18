/**
 * Analyst tool: Query gathered data with structured search.
 *
 * Read-only verification tool for the analyst subgraph.
 * Performs structured searches over already-gathered data in state.
 *
 * Stub implementation — Phase 6 adds real query logic.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * Structured search over gathered data in investigation state.
 */
export const queryGatheredData = tool(
  async (input) => {
    return JSON.stringify({
      results: [],
      message: `Stub: would query gathered data for "${input.query}" in ${input.dataSource}`,
    })
  },
  {
    name: "query_gathered_data",
    description:
      "Search through already-gathered investigation data (logs, commits, deployments) for specific patterns",
    schema: z.object({
      query: z.string().describe("What to search for in the gathered data"),
      dataSource: z
        .enum(["logs", "commits", "deployments", "metrics", "all"])
        .describe("Which data source to search"),
      timeRange: z
        .object({
          from: z.string().describe("ISO timestamp start"),
          to: z.string().describe("ISO timestamp end"),
        })
        .optional()
        .describe("Optional time range filter"),
    }),
  },
)
