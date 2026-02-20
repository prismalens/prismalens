import { z } from "zod";

/**
 * Agent roles in the investigation workflow.
 *
 * - entry: First node in the graph (scout). Not routable by supervisor.
 * - orchestrator: Routes work to other agents (supervisor). Not routable.
 * - worker: Performs investigation work. Routable by supervisor.
 */
export type AgentRole = "entry" | "orchestrator" | "worker";

/**
 * Investigation Agent Identity Registry (SSOT).
 *
 * Defines all agent identities used in the investigation workflow.
 * This is the single source of truth — imported by contracts, agents package, and frontend.
 * Browser-safe: no Node.js dependencies.
 */
export const INVESTIGATION_AGENTS = {
	scout: {
		id: "scout",
		name: "Scout",
		description: "Initial alert validation and triage",
		role: "entry" as const,
	},
	gatherer: {
		id: "gatherer",
		name: "Gatherer",
		description: "Deep data collection from integrations",
		role: "worker" as const,
	},
	analyst: {
		id: "analyst",
		name: "Analyst",
		description: "Root cause analysis and hypothesis generation",
		role: "worker" as const,
	},
	resolver: {
		id: "resolver",
		name: "Resolver",
		description: "Remediation recommendations and fix suggestions",
		role: "worker" as const,
	},
	supervisor: {
		id: "supervisor",
		name: "Supervisor",
		description: "Orchestrates agent workflow and routing",
		role: "orchestrator" as const,
	},
} as const;

export type AgentId = keyof typeof INVESTIGATION_AGENTS;

export const AGENT_IDS = Object.keys(INVESTIGATION_AGENTS) as [
	AgentId,
	...AgentId[],
];

export const agentIdSchema = z.enum(AGENT_IDS);

/**
 * Type-level extraction of worker agent IDs from the registry.
 */
export type RoutableAgentId = {
	[K in AgentId]: (typeof INVESTIGATION_AGENTS)[K]["role"] extends "worker"
		? K
		: never;
}[AgentId];

/**
 * Agent IDs filtered by role, derived from the registry at runtime.
 */
export const ROUTABLE_AGENT_IDS = Object.entries(INVESTIGATION_AGENTS)
	.filter(([, a]) => a.role === "worker")
	.map(([id]) => id) as [RoutableAgentId, ...RoutableAgentId[]];
