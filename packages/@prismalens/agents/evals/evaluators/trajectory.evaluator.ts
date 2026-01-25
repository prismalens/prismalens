/**
 * Trajectory Evaluator
 *
 * Evaluates agent trajectory - the sequence of tool calls and decisions.
 * Uses agentevals for trajectory matching when available.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ToolCall {
	name: string;
	args?: Record<string, unknown>;
}

export interface TrajectoryEvaluationResult {
	/** Overall score (0-100) */
	score: number;
	/** Whether required tools were called */
	requiredToolsCalled: boolean;
	/** Tools that were expected but not called */
	missingTools: string[];
	/** Tools that were called */
	calledTools: string[];
	/** Detailed feedback */
	feedback: string[];
}

export interface TrajectoryEvaluationOptions {
	/** Required tools that must be called */
	requiredTools?: string[];
	/** Tools that should NOT be called */
	forbiddenTools?: string[];
	/** Maximum allowed tool calls */
	maxToolCalls?: number;
	/** Match mode: "strict" | "subset" | "superset" */
	matchMode?: "strict" | "subset" | "superset";
}

// =============================================================================
// EVALUATOR
// =============================================================================

/**
 * Evaluate agent trajectory.
 */
export function evaluateTrajectory(
	toolCalls: ToolCall[],
	options: TrajectoryEvaluationOptions = {},
): TrajectoryEvaluationResult {
	const {
		requiredTools = [],
		forbiddenTools = [],
		maxToolCalls,
		matchMode = "subset",
	} = options;

	const feedback: string[] = [];
	const calledTools = toolCalls.map((tc) => tc.name);
	const calledToolsSet = new Set(calledTools);

	// Check required tools
	const missingTools = requiredTools.filter((t) => !calledToolsSet.has(t));
	const requiredToolsCalled = missingTools.length === 0;

	if (missingTools.length > 0) {
		feedback.push(`Missing required tools: ${missingTools.join(", ")}`);
	}

	// Check forbidden tools
	const calledForbidden = forbiddenTools.filter((t) => calledToolsSet.has(t));
	if (calledForbidden.length > 0) {
		feedback.push(`Called forbidden tools: ${calledForbidden.join(", ")}`);
	}

	// Check max tool calls
	if (maxToolCalls && toolCalls.length > maxToolCalls) {
		feedback.push(`Too many tool calls: ${toolCalls.length} > ${maxToolCalls}`);
	}

	// Calculate score based on match mode
	let score = 0;

	if (matchMode === "subset") {
		// Score based on how many required tools were called
		if (requiredTools.length > 0) {
			const calledRequired = requiredTools.filter((t) => calledToolsSet.has(t));
			score = (calledRequired.length / requiredTools.length) * 100;
		} else {
			score = 100; // No requirements = perfect score
		}
	} else if (matchMode === "strict") {
		// Must call exactly the required tools
		if (requiredTools.length === 0) {
			score = 100;
		} else {
			const exactMatch =
				requiredToolsCalled &&
				calledTools.length === requiredTools.length;
			score = exactMatch ? 100 : 0;
		}
	} else if (matchMode === "superset") {
		// Must call at least the required tools
		score = requiredToolsCalled ? 100 : 0;
	}

	// Penalize forbidden tool usage
	if (calledForbidden.length > 0) {
		score = Math.max(0, score - calledForbidden.length * 20);
	}

	// Penalize excessive tool calls
	if (maxToolCalls && toolCalls.length > maxToolCalls) {
		const excess = toolCalls.length - maxToolCalls;
		score = Math.max(0, score - excess * 5);
	}

	return {
		score: Math.round(score),
		requiredToolsCalled,
		missingTools,
		calledTools,
		feedback,
	};
}

/**
 * Extract tool calls from investigation result.
 */
export function extractToolCalls(
	result: Record<string, unknown>,
): ToolCall[] {
	// Try to extract from common result structures
	const toolCalls: ToolCall[] = [];

	// Check for agentExecutions (from InvestigationResult)
	const agentExecutions = result.agentExecutions as Array<{
		toolExecutions?: Array<{ toolName: string; arguments?: unknown }>;
	}>;

	if (Array.isArray(agentExecutions)) {
		for (const execution of agentExecutions) {
			if (Array.isArray(execution.toolExecutions)) {
				for (const tool of execution.toolExecutions) {
					toolCalls.push({
						name: tool.toolName,
						args: tool.arguments as Record<string, unknown>,
					});
				}
			}
		}
	}

	// Check for messages with tool_calls (LangChain format)
	const messages = result.messages as Array<{
		tool_calls?: Array<{ name: string; args?: unknown }>;
	}>;

	if (Array.isArray(messages)) {
		for (const message of messages) {
			if (Array.isArray(message.tool_calls)) {
				for (const tool of message.tool_calls) {
					toolCalls.push({
						name: tool.name,
						args: tool.args as Record<string, unknown>,
					});
				}
			}
		}
	}

	return toolCalls;
}

// =============================================================================
// EXPECTED TRAJECTORIES
// =============================================================================

/**
 * Expected trajectory for a successful investigation.
 * Commander should delegate to subagents in order.
 */
export const EXPECTED_INVESTIGATION_TRAJECTORY = {
	requiredTools: ["task"], // Commander uses 'task' to delegate
	forbiddenTools: [], // No specific restrictions
	maxToolCalls: 20, // Reasonable limit
};

/**
 * Expected trajectory for Cartographer subagent.
 */
export const EXPECTED_CARTOGRAPHER_TRAJECTORY = {
	requiredTools: [], // Will vary based on integrations available
	forbiddenTools: ["form_hypothesis", "propose_fix"], // These are for other agents
	maxToolCalls: 10,
};

/**
 * Expected trajectory for Detective subagent.
 */
export const EXPECTED_DETECTIVE_TRAJECTORY = {
	requiredTools: ["form_hypothesis"],
	forbiddenTools: ["propose_fix"], // Fix is for Surgeon
	maxToolCalls: 10,
};

/**
 * Expected trajectory for Surgeon subagent.
 */
export const EXPECTED_SURGEON_TRAJECTORY = {
	requiredTools: [], // May or may not propose fix depending on confidence
	forbiddenTools: ["form_hypothesis"], // Hypothesis is for Detective
	maxToolCalls: 10,
};
