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
	INVESTIGATION_AGENTS,
	AGENT_IDS,
	type AgentId,
	agentIdSchema,
} from "./providers/agents.js";
