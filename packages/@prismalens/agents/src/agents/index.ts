// =============================================================================
// AGENTS INDEX
// =============================================================================
// Export all agent-related modules.
// =============================================================================

// Commander Agent
export {
	type CommanderConfig,
	createCommander,
	createCommanderFromState,
} from "./commander/agent.js";

export {
	buildCommanderPrompt,
	buildTaskDescription,
	COMMANDER_SYSTEM_PROMPT,
} from "./commander/prompts.js";

// SubAgents
export {
	createAdversarySubAgent,
	createCartographerSubAgent,
	createDetectiveSubAgent,
	createSubAgents,
	createSurgeonSubAgent,
	getSubAgent,
	type SubAgentConfig,
} from "./subagents/index.js";
