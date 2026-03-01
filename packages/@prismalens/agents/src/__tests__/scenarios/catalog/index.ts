/**
 * Scenario catalog — registry + filtering.
 */

import type { ScenarioDefinition, DifficultyTier } from "../types.js"
import { NPE_WITH_GITHUB } from "./npe-with-github.js"
import { MISSING_ENV_VAR } from "./missing-env-var.js"
import { CONNECTION_POOL } from "./connection-pool.js"
import { MEMORY_LEAK } from "./memory-leak.js"
import { TIMEOUT_CASCADE } from "./timeout-cascade.js"
import { FEATURE_FLAG } from "./feature-flag.js"

/**
 * All registered scenarios.
 */
export const ALL_SCENARIOS: ScenarioDefinition[] = [
  NPE_WITH_GITHUB,
  MISSING_ENV_VAR,
  CONNECTION_POOL,
  MEMORY_LEAK,
  TIMEOUT_CASCADE,
  FEATURE_FLAG,
]

/**
 * Filter criteria for selective scenario execution.
 */
interface ScenarioFilter {
  difficulty?: DifficultyTier
  category?: string
  tags?: string[]
  ids?: string[]
}

/**
 * Filter scenarios by criteria. All criteria are AND-ed.
 */
export function filterScenarios(
  filter: ScenarioFilter,
  scenarios = ALL_SCENARIOS,
): ScenarioDefinition[] {
  return scenarios.filter((s) => {
    if (filter.difficulty && s.difficulty !== filter.difficulty) return false
    if (filter.category && s.category !== filter.category) return false
    if (filter.tags && !filter.tags.every((t) => s.tags.includes(t))) return false
    if (filter.ids && !filter.ids.includes(s.id)) return false
    return true
  })
}
