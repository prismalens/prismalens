import { createDeepAgent } from "deepagents";
import { createLLM } from "../../llm/factory.js";
import { createToolsForAgent } from "../../tools/factory.js";
import type {
	IntegrationContext,
	InvestigationState,
} from "../../types/state.js";
import { createSubAgents, type SubAgentConfig } from "../subagents/index.js";
import { buildCommanderPrompt, COMMANDER_SYSTEM_PROMPT } from "./prompts.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommanderAgent = ReturnType<typeof createDeepAgent>;

// =============================================================================
// COMMANDER DEEP AGENT
// =============================================================================
// The main orchestrating agent that uses DeepAgents' write_todos for planning
// and delegates to SubAgents (Cartographer, Detective, Surgeon) for specific tasks.
// =============================================================================

/**
 * Configuration for creating the Commander agent
 */
export interface CommanderConfig {
	/** Available integrations for tools (GitHub, Render, etc.) */
	integrations?: IntegrationContext[];
	/** Model overrides per agent */
	models?: {
		commander?: string;
		cartographer?: string;
		detective?: string;
		surgeon?: string;
	};
	/** Maximum iterations for the agent */
	maxIterations?: number;
	/** LangChain callbacks for tracing */
	callbacks?: any[];
	/** Incident-specific context for the prompt */
	incidentContext?: {
		alertSummary?: string;
		serviceName?: string;
		incidentId?: string;
		priority?: "low" | "normal" | "high" | "critical";
	};
}

/**
 * Create the Commander DeepAgent with integration support.
 *
 * @example
 * // Basic usage
 * const agent = createCommander();
 * const result = await agent.invoke({ messages: [{ role: 'user', content: '...' }] });
 *
 * @example
 * // With integrations and incident context
 * const agent = createCommander({
 *   integrations: [
 *     { type: 'github', connectionId: '...', credentials: {...}, config: {...} }
 *   ],
 *   incidentContext: {
 *     alertSummary: 'High CPU usage detected',
 *     serviceName: 'api-server',
 *     incidentId: 'INC-123',
 *     priority: 'high'
 *   }
 * });
 */
export function createCommander(config: CommanderConfig = {}): CommanderAgent {
	const integrations = config.integrations || [];

	// Create subagents with integrations support
	const subagentConfig: SubAgentConfig = {
		integrations,
		models: config.models,
	};
	const subagents = createSubAgents(subagentConfig);

	// Create Commander's direct tools (for direct investigation if needed)
	const commanderTools = createToolsForAgent("commander", integrations);

	// Build prompt with incident context if provided
	const systemPrompt = config.incidentContext
		? buildCommanderPrompt(config.incidentContext)
		: COMMANDER_SYSTEM_PROMPT;

	// Create the LLM for Commander
	const model = createLLM({
		agentName: "commander",
		modelName: config.models?.commander,
		callbacks: config.callbacks,
	});

	// Create the DeepAgent with write_todos and task tools built-in
	// Note: maxIterations is managed externally, not passed to createDeepAgent
	const agent = createDeepAgent({
		name: "incident_commander",
		model,
		systemPrompt,
		tools: commanderTools,
		subagents,
	});

	return agent;
}

/**
 * Create Commander from investigation state.
 * This is the preferred method when called from the LangGraph wrapper.
 */
export function createCommanderFromState(
	state: InvestigationState,
): CommanderAgent {
	// Extract incident context from state
	const primaryAlert = state.primaryAlert;
	const incidentContext = primaryAlert
		? {
				alertSummary:
					primaryAlert.title +
					(primaryAlert.description ? `: ${primaryAlert.description}` : ""),
				serviceName: primaryAlert.serviceName,
				incidentId: state.incidentId,
				priority: state.priority,
			}
		: {
				incidentId: state.incidentId,
				priority: state.priority,
			};

	return createCommander({
		integrations: state.integrations,
		incidentContext,
		// Note: maxIterations is tracked in state but not passed to createDeepAgent
	});
}

// =============================================================================
// LEGACY EXPORTS
// =============================================================================
// For backward compatibility with existing code

/**
 * @deprecated Use createCommander() instead
 */
export function createDeepRCAAgent(): CommanderAgent {
	return createCommander();
}

/**
 * Default agent instance for LangGraph Studio.
 * Note: This instance doesn't have integration credentials - use createCommander()
 * with integrations for production use.
 */
export const graph: CommanderAgent = createCommander();

// Export the type for external use
export type { CommanderAgent };
