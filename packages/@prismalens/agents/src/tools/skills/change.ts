/**
 * Change skill — tools for tracking code changes and deployments.
 *
 * Dual exports:
 * - changeSkill: Full skill object (used by gatherer via loadSkills())
 * - getRecentCommits, getDeploymentHistory: Individual tools (used by scout)
 *
 * Stub implementation — Phase 3 adds GitHub/Render provider implementations.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"
import type { Skill } from "../types.js"

/**
 * Get recent commits for a service.
 */
export const getRecentCommits = tool(
  async (input) => {
    return JSON.stringify({
      commits: [],
      message: `Stub: would get commits for service ${input.serviceId} since ${input.since}`,
    })
  },
  {
    name: "get_recent_commits",
    description:
      "Get recent git commits for a service, useful for correlating code changes with incidents",
    schema: z.object({
      serviceId: z.string().describe("Service ID to get commits for"),
      since: z.string().describe("ISO timestamp to get commits from"),
      limit: z.number().optional().default(20).describe("Max commits to return"),
    }),
  },
)

/**
 * Get deployment history for a service.
 */
export const getDeploymentHistory = tool(
  async (input) => {
    return JSON.stringify({
      deployments: [],
      message: `Stub: would get deployment history for service ${input.serviceId}`,
    })
  },
  {
    name: "get_deployment_history",
    description:
      "Get recent deployments for a service, useful for identifying deployment-related issues",
    schema: z.object({
      serviceId: z.string().describe("Service ID to get deployments for"),
      limit: z.number().optional().default(5).describe("Max deployments to return"),
    }),
  },
)

/**
 * Change skill — bundles change tracking tools with metadata.
 */
export const changeSkill: Skill = {
  name: "change",
  description: "Track code changes and deployment history",
  category: "change",
  tools: [getRecentCommits, getDeploymentHistory],
  requiredIntegrations: ["github", "gitlab"],
}
