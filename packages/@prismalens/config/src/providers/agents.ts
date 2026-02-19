import { z } from "zod";

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
	},
	gatherer: {
		id: "gatherer",
		name: "Gatherer",
		description: "Deep data collection from integrations",
	},
	analyst: {
		id: "analyst",
		name: "Analyst",
		description: "Root cause analysis and hypothesis generation",
	},
	resolver: {
		id: "resolver",
		name: "Resolver",
		description: "Remediation recommendations and fix suggestions",
	},
	supervisor: {
		id: "supervisor",
		name: "Supervisor",
		description: "Orchestrates agent workflow and routing",
	},
} as const;

export type AgentId = keyof typeof INVESTIGATION_AGENTS;

export const AGENT_IDS = Object.keys(INVESTIGATION_AGENTS) as [
	AgentId,
	...AgentId[],
];

export const agentIdSchema = z.enum(AGENT_IDS);
