/**
 * Mapping functions from agent-internal enums to DB-aligned enums.
 *
 * Agent LLM structured output uses fine-grained categories
 * that must be mapped to the coarser DB enum values before persistence.
 */

import type {
  RootCauseCategory,
  Urgency,
  RecommendationCategory,
  ToolCategory,
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

/**
 * Map resolver urgency → DB Urgency.
 */
export function mapAgentUrgencyToDb(agentUrgency: string): Urgency {
  switch (agentUrgency) {
    case "immediate":
    case "next_hour":
      return "immediate"
    case "next_day":
      return "short_term"
    case "backlog":
      return "long_term"
    default:
      return "short_term"
  }
}

/**
 * Map resolver fix category → DB RecommendationCategory.
 */
export function mapFixCategoryToDb(
  agentCategory: string,
): RecommendationCategory {
  switch (agentCategory) {
    case "code_fix":
      return "code_fix"
    case "config_change":
      return "config_change"
    case "rollback":
      return "rollback"
    case "infrastructure":
      return "monitoring"
    case "escalation":
      return "investigation"
    default:
      return "investigation"
  }
}

/**
 * Map gatherer tool category → DB ToolCategory.
 */
export function mapToolCategoryToDb(agentCategory: string): ToolCategory {
  switch (agentCategory) {
    case "log":
    case "logs":
      return "logs"
    case "code":
    case "search":
      return "search"
    case "change":
    case "github":
      return "github"
    case "precedent":
    case "analysis":
      return "analysis"
    case "file":
      return "file"
    default:
      return "analysis"
  }
}
