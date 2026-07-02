/**
 * @prismalens/config/agents
 *
 * Investigation agent identity registry (SSOT).
 * Browser-safe: no Node.js dependencies.
 *
 * @example
 * ```typescript
 * import { INVESTIGATION_AGENTS, agentIdSchema, type AgentId } from '@prismalens/config/agents';
 * ```
 */

export {
	AGENT_IDS,
	type AgentId,
	type AgentRole,
	agentIdSchema,
	INVESTIGATION_AGENTS,
	ROUTABLE_AGENT_IDS,
	type RoutableAgentId,
} from "./providers/agents.js";
