/**
 * Centralized env config consumption for the agents package.
 *
 * Thin wrappers around Zod schemas from @prismalens/config.
 * Each getter validates + caches on first call (Zod defaults apply).
 */

import {
  graphEnvSchema,
  scoutEnvSchema,
  AGENT_BUDGET_DEFAULTS,
  type AgentBudgetConfig,
  type GraphEnvConfig,
  type ScoutEnvConfig,
} from "@prismalens/config"
import type { AgentId } from "@prismalens/config/agents"

// ── Graph Config (cached, parsed once via Zod) ──────────────────────

let _graphConfig: GraphEnvConfig | null = null

export function getGraphConfig(): GraphEnvConfig {
  if (!_graphConfig) _graphConfig = graphEnvSchema.parse(process.env)
  return _graphConfig
}

// ── Scout Config (cached, parsed once via Zod) ──────────────────────

let _scoutConfig: ScoutEnvConfig | null = null

export function getScoutConfig(): ScoutEnvConfig {
  if (!_scoutConfig) _scoutConfig = scoutEnvSchema.parse(process.env)
  return _scoutConfig
}

// ── Per-Agent Budget (registry-driven) ──────────────────────────────

/**
 * Resolve tool budgets for an agent.
 *
 * Reads PRISMALENS_{AGENT_ID}_HTTP_BUDGET and _WEB_BUDGET from env,
 * falling back to AGENT_BUDGET_DEFAULTS. Agents not in the defaults
 * map get { httpBudget: 0, webBudget: 0 } (no tool access by default).
 */
export function getAgentBudget(agentId: AgentId): AgentBudgetConfig {
  const defaults = AGENT_BUDGET_DEFAULTS[agentId as keyof typeof AGENT_BUDGET_DEFAULTS]
    ?? { httpBudget: 0, webBudget: 0 }
  const prefix = `PRISMALENS_${agentId.toUpperCase()}`
  return {
    httpBudget: parseEnvInt(`${prefix}_HTTP_BUDGET`, defaults.httpBudget),
    webBudget: parseEnvInt(`${prefix}_WEB_BUDGET`, defaults.webBudget),
  }
}

function parseEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key]
  if (raw === undefined) return defaultValue
  const parsed = parseInt(raw, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

// ── Reset (for testing) ─────────────────────────────────────────────

function resetEnvConfig(): void {
  _graphConfig = null
  _scoutConfig = null
}

// Reserved for testing use
void resetEnvConfig;
