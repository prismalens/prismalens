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
 * Expected trajectory for Gatherer subagent.
 */
export const EXPECTED_GATHERER_TRAJECTORY = {
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

// =============================================================================
// ENHANCED TRAJECTORY EVALUATION (ARGUMENT VALIDATION)
// =============================================================================

export interface ArgumentRelevanceResult {
	/** Percentage of expected search terms that were searched (0-100) */
	searchRelevance: number;
	/** Search terms that were found in tool calls */
	matchedSearchTerms: string[];
	/** Search terms that were expected but not found */
	missedSearchTerms: string[];
	/** Percentage of expected files that were read (0-100) */
	fileRelevance: number;
	/** Files that were read */
	matchedFiles: string[];
	/** Files that were expected but not read */
	missedFiles: string[];
	/** Percentage of evidence patterns that were captured (0-100) */
	evidenceCapture: number;
	/** Patterns that were found */
	matchedPatterns: string[];
	/** Patterns that were expected but not found */
	missedPatterns: string[];
}

export interface EnhancedTrajectoryResult extends TrajectoryEvaluationResult {
	/** Argument relevance scores */
	argumentRelevance: ArgumentRelevanceResult;
	/** Enhanced score combining trajectory and argument relevance */
	enhancedScore: number;
}

export interface EnhancedTrajectoryOptions extends TrajectoryEvaluationOptions {
	/** Search terms the agent should have searched for */
	expectedSearchTerms?: string[];
	/** Files the agent should have read */
	expectedFilesToRead?: string[];
	/** Regex patterns that should appear in tool arguments */
	expectedEvidencePatterns?: string[];
}

/**
 * Normalize text for comparison.
 */
function normalizeForComparison(text: string): string {
	return text.toLowerCase().trim();
}

/**
 * Extract all string values from tool arguments (recursively).
 */
function extractArgumentStrings(args: Record<string, unknown> | undefined): string[] {
	if (!args) return [];
	const strings: string[] = [];

	function extract(value: unknown): void {
		if (typeof value === "string") {
			strings.push(value);
		} else if (Array.isArray(value)) {
			for (const item of value) {
				extract(item);
			}
		} else if (value && typeof value === "object") {
			for (const v of Object.values(value)) {
				extract(v);
			}
		}
	}

	extract(args);
	return strings;
}

/**
 * Evaluate search term relevance.
 * Checks if expected search terms were used in tool arguments.
 */
export function evaluateSearchRelevance(
	toolCalls: ToolCall[],
	expectedTerms: string[],
): { score: number; matched: string[]; missed: string[] } {
	if (!expectedTerms || expectedTerms.length === 0) {
		return { score: 100, matched: [], missed: [] };
	}

	// Extract all strings from tool arguments
	const allArgStrings = toolCalls.flatMap((tc) =>
		extractArgumentStrings(tc.args),
	);
	const combinedArgs = allArgStrings.join(" ").toLowerCase();

	const matched: string[] = [];
	const missed: string[] = [];

	for (const term of expectedTerms) {
		const normalizedTerm = normalizeForComparison(term);
		if (combinedArgs.includes(normalizedTerm)) {
			matched.push(term);
		} else {
			missed.push(term);
		}
	}

	const score = Math.round((matched.length / expectedTerms.length) * 100);
	return { score, matched, missed };
}

/**
 * Evaluate file relevance.
 * Checks if expected files were read/accessed by the agent.
 */
export function evaluateFileRelevance(
	toolCalls: ToolCall[],
	expectedFiles: string[],
): { score: number; matched: string[]; missed: string[] } {
	if (!expectedFiles || expectedFiles.length === 0) {
		return { score: 100, matched: [], missed: [] };
	}

	// Extract file paths from tool arguments
	const allArgStrings = toolCalls.flatMap((tc) =>
		extractArgumentStrings(tc.args),
	);

	const matched: string[] = [];
	const missed: string[] = [];

	for (const file of expectedFiles) {
		const normalizedFile = normalizeForComparison(file);
		// Check if any argument contains this file path (partial match OK)
		const found = allArgStrings.some((arg) =>
			normalizeForComparison(arg).includes(normalizedFile),
		);
		if (found) {
			matched.push(file);
		} else {
			missed.push(file);
		}
	}

	const score = Math.round((matched.length / expectedFiles.length) * 100);
	return { score, matched, missed };
}

/**
 * Evaluate evidence pattern capture.
 * Checks if expected patterns (regex) appear in tool arguments.
 */
export function evaluateEvidenceCapture(
	toolCalls: ToolCall[],
	expectedPatterns: string[],
): { score: number; matched: string[]; missed: string[] } {
	if (!expectedPatterns || expectedPatterns.length === 0) {
		return { score: 100, matched: [], missed: [] };
	}

	// Extract all strings from tool arguments
	const allArgStrings = toolCalls.flatMap((tc) =>
		extractArgumentStrings(tc.args),
	);
	const combinedArgs = allArgStrings.join(" ");

	const matched: string[] = [];
	const missed: string[] = [];

	for (const pattern of expectedPatterns) {
		try {
			const regex = new RegExp(pattern, "i");
			if (regex.test(combinedArgs)) {
				matched.push(pattern);
			} else {
				missed.push(pattern);
			}
		} catch {
			// If pattern is invalid regex, treat as literal string match
			if (combinedArgs.toLowerCase().includes(pattern.toLowerCase())) {
				matched.push(pattern);
			} else {
				missed.push(pattern);
			}
		}
	}

	const score = Math.round((matched.length / expectedPatterns.length) * 100);
	return { score, matched, missed };
}

/**
 * Evaluate trajectory with enhanced argument validation.
 *
 * Combines traditional trajectory evaluation (tool sequence) with
 * argument validation (did the agent search for/read the right things).
 *
 * @param toolCalls - Tool calls made by the agent
 * @param options - Enhanced options with argument expectations
 * @returns Enhanced trajectory result with argument relevance
 */
export function evaluateTrajectoryEnhanced(
	toolCalls: ToolCall[],
	options: EnhancedTrajectoryOptions = {},
): EnhancedTrajectoryResult {
	// Run base trajectory evaluation
	const baseResult = evaluateTrajectory(toolCalls, options);

	// Evaluate argument relevance
	const searchResult = evaluateSearchRelevance(
		toolCalls,
		options.expectedSearchTerms ?? [],
	);
	const fileResult = evaluateFileRelevance(
		toolCalls,
		options.expectedFilesToRead ?? [],
	);
	const evidenceResult = evaluateEvidenceCapture(
		toolCalls,
		options.expectedEvidencePatterns ?? [],
	);

	const argumentRelevance: ArgumentRelevanceResult = {
		searchRelevance: searchResult.score,
		matchedSearchTerms: searchResult.matched,
		missedSearchTerms: searchResult.missed,
		fileRelevance: fileResult.score,
		matchedFiles: fileResult.matched,
		missedFiles: fileResult.missed,
		evidenceCapture: evidenceResult.score,
		matchedPatterns: evidenceResult.matched,
		missedPatterns: evidenceResult.missed,
	};

	// Calculate enhanced score
	// Weights: 50% base trajectory, 20% search, 15% file, 15% evidence
	const enhancedScore = Math.round(
		baseResult.score * 0.5 +
			searchResult.score * 0.2 +
			fileResult.score * 0.15 +
			evidenceResult.score * 0.15,
	);

	return {
		...baseResult,
		argumentRelevance,
		enhancedScore,
	};
}
