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
	createDeepRCAAgent,
	graph,
} from "./commander/agent.js";

export {
	buildCommanderPrompt,
	buildTaskDescription,
	COMMANDER_SYSTEM_PROMPT,
} from "./commander/prompts.js";

// SubAgents
export {
	// Legacy exports
	cartographerSubagent,
	createCartographerSubAgent,
	createDetectiveSubAgent,
	createSubAgents,
	createSurgeonSubAgent,
	detectiveSubagent,
	getSubAgent,
	type SubAgentConfig,
	subagents,
	surgeonSubagent,
} from "./subagents/index.js";
