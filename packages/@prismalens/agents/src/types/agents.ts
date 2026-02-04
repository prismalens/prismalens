import { z } from "zod";

/**
 * Canonical list of agent IDs in the PrismaLens investigation system.
 *
 * - commander: Main orchestrating agent (DeepAgents)
 * - gatherer: Read-only context gathering role (shared by log-gatherer, code-searcher, change-tracker)
 * - detective: Root cause analyzer (SubAgent)
 * - surgeon: Fix proposer (SubAgent)
 *
 * This is the single source of truth for agent IDs.
 * Import this when you need to reference agent names.
 */
export const AGENT_IDS = [
	"commander",
	"gatherer",
	"detective",
	"surgeon",
] as const;

/**
 * Type for valid agent IDs.
 */
export type AgentId = (typeof AGENT_IDS)[number];

/**
 * Zod schema for agent IDs.
 * Use this for runtime validation of agent ID inputs.
 */
export const agentIdSchema = z.enum(AGENT_IDS);
