/**
 * @prismalens/agents/browser
 *
 * Browser-safe exports for frontend use.
 * This module ONLY exports static data and types - no Node.js/LangGraph dependencies.
 *
 * @example
 * ```typescript
 * import { AGENT_IDS, agentIdSchema, type AgentId } from '@prismalens/agents/browser';
 * ```
 */

export { AGENT_IDS, agentIdSchema, type AgentId } from "./types/agents.js";
