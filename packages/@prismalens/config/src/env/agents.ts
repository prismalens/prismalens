import { z } from "zod";
import type { AgentId } from "../providers/agents.js";

// ── Graph-Level Config ──────────────────────────────────────────────

/** Graph-level infrastructure config — shared across the entire investigation. */
export const graphEnvSchema = z.object({
	// ── LLM Defaults ──────────────────────────────────────────
	PRISMALENS_LLM_TEMPERATURE: z.coerce
		.number()
		.min(0)
		.max(2)
		.default(0.2)
		.describe("Default LLM temperature"),
	PRISMALENS_LLM_MAX_TOKENS: z.coerce
		.number()
		.int()
		.min(256)
		.default(4096)
		.describe("Default max output tokens per LLM call"),
	PRISMALENS_LLM_MAX_RETRIES: z.coerce
		.number()
		.int()
		.min(0)
		.max(10)
		.default(3)
		.describe("Max LLM API retries per call (exponential backoff)"),

	// ── Graph Retry Policy ────────────────────────────────────
	PRISMALENS_GRAPH_RETRY_MAX_ATTEMPTS: z.coerce
		.number()
		.int()
		.min(1)
		.max(5)
		.default(2)
		.describe("Max retry attempts for graph node failures"),
	PRISMALENS_GRAPH_RETRY_INITIAL_INTERVAL_MS: z.coerce
		.number()
		.int()
		.min(100)
		.default(1000)
		.describe("Initial backoff delay for graph retries (ms)"),
	PRISMALENS_GRAPH_RETRY_BACKOFF_FACTOR: z.coerce
		.number()
		.min(1)
		.max(10)
		.default(2)
		.describe("Backoff multiplier for graph retries"),

	// ── Investigation Execution ───────────────────────────────
	PRISMALENS_INVESTIGATION_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.min(30_000)
		.default(300_000)
		.describe("Total investigation timeout (ms, default 5 min)"),
	PRISMALENS_MAX_ITERATIONS: z.coerce
		.number()
		.int()
		.min(1)
		.max(100)
		.default(8)
		.describe("Max supervisor routing iterations"),

	// ── HTTP Request Tool (global defaults) ───────────────────
	PRISMALENS_HTTP_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.min(1000)
		.default(30_000)
		.describe("HTTP request timeout (ms)"),
	PRISMALENS_HTTP_MAX_BODY_SIZE: z.coerce
		.number()
		.int()
		.min(1000)
		.default(10_000)
		.describe("Max HTTP request body size (chars)"),
	PRISMALENS_HTTP_MAX_RESPONSE_SIZE: z.coerce
		.number()
		.int()
		.min(1000)
		.default(50_000)
		.describe("Max HTTP response size before truncation (chars)"),

	// ── Web Browse Tool (global defaults) ─────────────────────
	PRISMALENS_WEB_BROWSE_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.min(1000)
		.default(30_000)
		.describe("Web browse fetch timeout (ms)"),
	PRISMALENS_WEB_BROWSE_MAX_CONTENT_SIZE: z.coerce
		.number()
		.int()
		.min(1000)
		.default(50_000)
		.describe("Max extracted page content (chars)"),
	PRISMALENS_WEB_BROWSE_MAX_REDIRECTS: z.coerce
		.number()
		.int()
		.min(1)
		.max(20)
		.default(5)
		.describe("Max redirect hops to follow"),

	// ── Workspace ─────────────────────────────────────────────
	PRISMALENS_WORKSPACE_BASE: z
		.string()
		.default("/tmp/prismalens-investigations")
		.describe("Base directory for investigation workspaces"),
});

export type GraphEnvConfig = z.infer<typeof graphEnvSchema>;

// ── Per-Agent Budget Config (Registry-Driven) ───────────────────────

export interface AgentBudgetConfig {
	httpBudget: number;
	webBudget: number;
}

/**
 * Default per-agent tool budgets. Keyed by AgentId for registry alignment.
 *
 * DRIFT PROTECTION: `satisfies Partial<Record<AgentId, ...>>` ensures all keys
 * are valid AgentIds. If an agent is removed from INVESTIGATION_AGENTS, this
 * fails to compile. Adding a new agent without a budget entry is safe —
 * getAgentBudget() returns { httpBudget: 0, webBudget: 0 } (no tool access).
 *
 * To give a new agent tool access: add one line here.
 */
export const AGENT_BUDGET_DEFAULTS = {
	gatherer: { httpBudget: 50, webBudget: 0 },
	analyst: { httpBudget: 30, webBudget: 10 },
	resolver: { httpBudget: 30, webBudget: 10 },
} as const satisfies Partial<Record<AgentId, AgentBudgetConfig>>;

export type AgentWithBudget = keyof typeof AGENT_BUDGET_DEFAULTS;

// ── Scout-Specific Domain Config ────────────────────────────────────

/** Scout-specific data sampling config. */
export const scoutEnvSchema = z.object({
	PRISMALENS_SCOUT_ALERT_LIMIT: z.coerce
		.number()
		.int()
		.min(1)
		.default(50)
		.describe("Max alerts to fetch in scout phase"),
	PRISMALENS_SCOUT_CHANGE_WINDOW_HOURS: z.coerce
		.number()
		.int()
		.min(1)
		.default(4)
		.describe("Change event lookback window (hours)"),
	PRISMALENS_SCOUT_SIMILAR_LIMIT: z.coerce
		.number()
		.int()
		.min(1)
		.default(5)
		.describe("Max similar incidents to fetch"),
});

export type ScoutEnvConfig = z.infer<typeof scoutEnvSchema>;
