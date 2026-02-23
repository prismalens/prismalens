/**
 * Log skill — tools for searching and analyzing logs.
 *
 * Individual tool exports used by gatherer (via skill loader) and scout.
 * Skill metadata is defined in skills/gatherer/log/SKILL.md.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"

/**
 * Search logs for a service within a time range.
 */
export const searchLogs = tool(
  async (input) => {
    // Stub: returns empty results
    return JSON.stringify({
      logs: [],
      message: `Stub: would search logs for service ${input.serviceId} since ${input.since}`,
    })
  },
  {
    name: "search_logs",
    description:
      "Search application and infrastructure logs for a service within a time range",
    schema: z.object({
      serviceId: z.string().describe("Service ID to search logs for"),
      since: z.string().describe("ISO timestamp to search from"),
      query: z.string().optional().describe("Optional search query"),
      limit: z.number().optional().default(100).describe("Max log entries to return"),
    }),
  },
)

/**
 * Analyze log patterns for anomalies and error spikes.
 */
export const analyzeLogPatterns = tool(
  async (input) => {
    // Stub: returns empty results
    return JSON.stringify({
      patterns: [],
      message: `Stub: would analyze log patterns for service ${input.serviceId}`,
    })
  },
  {
    name: "analyze_log_patterns",
    description:
      "Analyze log patterns to identify anomalies, error spikes, and recurring issues",
    schema: z.object({
      serviceId: z.string().describe("Service ID to analyze"),
      since: z.string().describe("ISO timestamp to analyze from"),
      until: z.string().optional().describe("ISO timestamp to analyze until"),
    }),
  },
)
