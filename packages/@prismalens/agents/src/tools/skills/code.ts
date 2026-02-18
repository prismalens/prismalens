/**
 * Code skill — tools for searching code and retrieving file contents.
 *
 * Dual exports:
 * - codeSkill: Full skill object (used by gatherer via loadSkills())
 * - searchCode, getFileContent: Individual tools (used by scout/analyst)
 *
 * Stub implementation — Phase 3 adds GitHub/GitLab provider implementations.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"
import type { Skill } from "../types.js"

/**
 * Search code across a repository.
 */
export const searchCode = tool(
  async (input) => {
    return JSON.stringify({
      results: [],
      message: `Stub: would search code for "${input.query}" in ${input.repo ?? "default repo"}`,
    })
  },
  {
    name: "search_code",
    description:
      "Search code across a repository for relevant patterns, functions, or configurations",
    schema: z.object({
      query: z.string().describe("Code search query"),
      repo: z.string().optional().describe("Repository to search in"),
      filePattern: z
        .string()
        .optional()
        .describe("File pattern to filter (e.g., '*.ts')"),
    }),
  },
)

/**
 * Get content of a specific file from a repository.
 */
export const getFileContent = tool(
  async (input) => {
    return JSON.stringify({
      content: null,
      message: `Stub: would get file ${input.path} from ${input.repo ?? "default repo"}`,
    })
  },
  {
    name: "get_file_content",
    description: "Retrieve the content of a specific file from a repository",
    schema: z.object({
      path: z.string().describe("File path within the repository"),
      repo: z.string().optional().describe("Repository name"),
      ref: z
        .string()
        .optional()
        .describe("Git ref (branch, tag, or commit SHA)"),
    }),
  },
)

/**
 * Code skill — bundles code tools with metadata.
 */
export const codeSkill: Skill = {
  name: "code",
  description: "Search code and retrieve file contents from repositories",
  category: "code",
  tools: [searchCode, getFileContent],
  requiredIntegrations: ["github", "gitlab"],
}
