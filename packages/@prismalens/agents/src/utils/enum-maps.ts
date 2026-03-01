/**
 * Mapping functions from agent-internal enums to DB-aligned enums.
 *
 * Agent LLM structured output uses fine-grained categories
 * that must be mapped to the coarser DB enum values before persistence.
 */

import type {
  RootCauseCategory,
} from "@prismalens/contracts/schemas"

/**
 * Map analyst hypothesis category → DB RootCauseCategory.
 */
export function mapHypothesisCategoryToDb(
  agentCategory: string,
): RootCauseCategory {
  switch (agentCategory) {
    case "code_bug":
    case "deployment":
      return "code"
    case "config_change":
      return "config"
    case "infrastructure":
      return "infrastructure"
    case "dependency":
      return "external"
    default:
      return "unknown"
  }
}

