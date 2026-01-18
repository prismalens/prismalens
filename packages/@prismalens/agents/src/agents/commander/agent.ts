import { createDeepAgent, type DeepAgent } from "deepagents";
import { createLLM } from "../../llm/factory.js";
import { createToolsForAgent } from "../../tools/factory.js";
import type {
	IntegrationContext,
	InvestigationState,
} from "../../types/state.js";
import { getIncidentDisplayInfo } from "../../types/state.js";
import { createSubAgents, type SubAgentConfig } from "../subagents/index.js";
import {
	buildCommanderPrompt,
	COMMANDER_SYSTEM_PROMPT,
	type CommanderIncidentContext,
	type CommanderAlertContext,
} from "./prompts.js";

// Use DeepAgent type directly to avoid type instantiation depth issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommanderAgent = DeepAgent<any>;

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
	/**
	 * Incident-specific context for the prompt (incident-centric approach - preferred)
	 */
	incidentContext?: CommanderIncidentContext | CommanderAlertContext;
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
	// Type cast to avoid TS2589: Type instantiation is excessively deep
	const agent = createDeepAgent({
		name: "incident_commander",
		model,
		systemPrompt,
		tools: commanderTools,
		subagents,
	}) as unknown as CommanderAgent;

	return agent;
}

/**
 * Create Commander from investigation state.
 * This is the preferred method when called from the LangGraph wrapper.
 * Uses incident-centric context when available, falls back to alert-based.
 */
export function createCommanderFromState(
	state: InvestigationState,
): CommanderAgent {
	// Use helper to extract incident display info (prefers incident, falls back to alerts)
	const displayInfo = getIncidentDisplayInfo(state);

	// Build incident-centric context
	const incidentContext: CommanderIncidentContext = {
		incidentId: displayInfo.incidentId,
		number: displayInfo.number,
		title: displayInfo.title,
		description: displayInfo.description,
		severity: displayInfo.severity,
		priority: displayInfo.priority,
		serviceName: displayInfo.serviceName,
		alertCount: displayInfo.alertCount,
		customerImpact: state.incident?.customerImpact,
	};

	return createCommander({
		integrations: state.integrations,
		incidentContext,
		// Note: maxIterations is tracked in state but not passed to createDeepAgent
	});
}

// Export the type for external use
export type { CommanderAgent };
