// =============================================================================
// AGENTS INDEX
// =============================================================================
// Export all agent-related modules.
// =============================================================================

// Commander Agent
export {
    createCommander,
    createCommanderFromState,
    createDeepRCAAgent,
    graph,
    type CommanderConfig,
} from './commander/agent.js';

export {
    buildCommanderPrompt,
    buildTaskDescription,
    COMMANDER_SYSTEM_PROMPT,
} from './commander/prompts.js';

// SubAgents
export {
    createSubAgents,
    createCartographerSubAgent,
    createDetectiveSubAgent,
    createSurgeonSubAgent,
    getSubAgent,
    type SubAgentConfig,
    // Legacy exports
    cartographerSubagent,
    detectiveSubagent,
    surgeonSubagent,
    subagents,
} from './subagents/index.js';
