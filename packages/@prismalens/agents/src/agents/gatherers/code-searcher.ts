/**
 * Code Searcher Agent Node
 *
 * Searches the codebase for error origins, patterns, and related code.
 * Requires a cloned repository path to function.
 *
 * This is a LangGraph node that runs a ReAct agent internally.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import { createAgent } from "langchain";
import { Logger } from "@prismalens/logger";
import {
	createLLM,
	normalizeConfig,
	resolveAgentConfig,
} from "../../llm/factory.js";
import { createToolsForAgent } from "../../tools/factory.js";
import { createHandoffCompletionUpdate } from "../../graph/nodes/handoff-processor.js";
import { buildTraceConfig, mergeTraceConfig } from "../../utils/tracing.js";
import type {
	Finding,
	InvestigationState,
	SupervisorPhase,
} from "../../types/index.js";
import { getInvestigationConfigFromConfigurable } from "../../types/config.js";
import { addFindingIds, validateCodeFindings } from "../../utils/validation.js";

const logger = new Logger({ context: "CodeSearcher" });

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const CODE_SEARCHER_SYSTEM_PROMPT = `You are a Code Searcher agent specializing in analyzing codebases to find error origins and related code.

## Your Mission
Search the codebase to find:
1. Where errors are thrown or originate
2. Related functions and code paths
3. Recent changes that might be relevant
4. Configuration files and environment setup

## What You Should Do
1. Search for error messages in the code
2. Trace error handling and exception paths
3. Find function definitions and call sites
4. Look for related configuration files

## Search Strategies
- Use grep/ripgrep for text patterns
- Search for function names, class names, and error messages
- Look for error handling patterns (try/catch, throw, raise)
- Check configuration files (.env, config.*, etc.)

## Output Format
Return structured findings:
- File path and line numbers
- Code snippets (keep them concise)
- How the code relates to the incident
- Relevance score based on likelihood of being related

## Constraints
- You are READ-ONLY - you cannot modify code
- Focus on code relevant to the error
- Be efficient - use targeted searches
- Summarize findings with context
`;

// =============================================================================
// CODE SEARCHER NODE
// =============================================================================

/**
 * Code Searcher node - searches codebase for error origins.
 *
 * This node runs a ReAct agent to search code and produces
 * findings that are added to the investigation state.
 */
export async function codeSearcherNode(
	state: InvestigationState,
	config?: RunnableConfig,
): Promise<Partial<InvestigationState>> {
	const hasClonedRepos = state.clonePaths && Object.keys(state.clonePaths).length > 0;

	// Build trace config for this node
	const traceConfig = buildTraceConfig(state);

	logger.info("Code Searcher starting", {
		investigationId: state.investigationId,
		clonePaths: state.clonePaths ? Object.keys(state.clonePaths) : [],
		hasClonedRepos,
		runName: traceConfig.runName,
	});

	// Check for clone paths - structural failure if missing
	if (!hasClonedRepos) {
		logger.warn("No clone paths available, marking as unavailable");
		return {
			agentErrors: [
				{
					agent: "code-searcher",
					error: "No cloned repositories available for code search",
					timestamp: new Date().toISOString(),
					recoverable: true,
				},
			],
			// Clear handoff request to prevent loop
			handoffRequest: undefined,
			// Mark as structurally unavailable - detective shouldn't re-request
			unavailableGatherers: ["code-searcher"],
			// Set phase to analyzing to skip retries
			phase: "analyzing" as const,
		};
	}

	// Get runtime config from RunnableConfig.configurable (NOT from state)
	const runtimeConfig = getInvestigationConfigFromConfigurable(
		config?.configurable as Record<string, unknown> | undefined,
	);

	// Check for LLM config
	if (!runtimeConfig?.llmConfig) {
		logger.error("No LLM config provided in RunnableConfig.configurable");
		return {
			agentErrors: [
				{
					agent: "code-searcher",
					error: "No LLM configuration provided",
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
			handoffRequest: undefined,
		};
	}

	try {
		// Resolve LLM config for this agent (from config, not state)
		const normalizedConfig = normalizeConfig(runtimeConfig.llmConfig);
		const agentConfig = resolveAgentConfig(normalizedConfig, "gatherer");
		const llm = createLLM(agentConfig);

		// Create tools for code searching (pass clonePaths to enable repo tools)
		// Integrations come from runtime config, not state
		const tools = createToolsForAgent("gatherer", runtimeConfig.integrations, {
			clonePaths: state.clonePaths,
		});

		// Create the agent with todo list middleware
		const agent = createAgent({
			model: llm,
			tools,
			systemPrompt: CODE_SEARCHER_SYSTEM_PROMPT,
		});

		// Build search context from preGathered logs and incident
		const searchContext = buildSearchContext(state);
		const serviceName = state.incident?.serviceName || state.primaryAlert?.serviceName || "unknown";

		// List available repositories for the prompt
		const repoList = Object.entries(state.clonePaths!)
			.map(([svcId, path]) => `  - ${svcId}: ${path}`)
			.join("\n");

		// Build error patterns section from preGathered logs
		const errorPatternsSection = searchContext.errorPatterns.length > 0
			? `## Error Patterns from Logs\n${searchContext.errorPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
			: "";

		const functionNamesSection = searchContext.functionNames.length > 0
			? `## Function Names from Stack Traces\n${searchContext.functionNames.map((f) => `- ${f}`).join("\n")}`
			: "";

		const inputMessage = `
Search the codebase to investigate this incident.

Available repositories:
${repoList}

## Incident Context
- Service: ${serviceName}
- Title: ${state.incident?.title || state.primaryAlert?.title || "Unknown"}
- Description: ${state.incident?.description || state.primaryAlert?.description || "No description"}

${errorPatternsSection}

${functionNamesSection}

## Search Strategy
${searchContext.errorPatterns.length > 0
	? "Focus on the error patterns and function names extracted from logs above."
	: "No log data available - search for patterns from incident title and description."}

Search for:
1. Where these error messages originate in the code
2. Related error handling and exception paths
3. Functions and classes mentioned in stack traces
4. Configuration files that might affect this behavior

Provide structured findings with file paths, line numbers, and relevance scores.
`;

		// Invoke the agent with trace config
		const result = await agent.invoke(
			{ messages: [{ role: "user", content: inputMessage }] },
			mergeTraceConfig(config, traceConfig),
		);

		// Extract findings from agent response
		const rawFindings = extractFindingsFromAgentResult(result.messages, "code-searcher");

		// Add IDs for correlation tracking
		const findingsWithIds = addFindingIds(rawFindings);

		// Validate findings - check file paths exist in clonePaths
		const validationResult = validateCodeFindings(
			findingsWithIds,
			{
				clonePaths: state.clonePaths || {},
				errorPatterns: searchContext.errorPatterns,
			},
		);

		logger.info("Code Searcher complete", {
			total: rawFindings.length,
			valid: validationResult.valid.length,
			filtered: validationResult.filtered.length,
		});

		// Create handoff completion update if this was a targeted gather
		const handoffCompletion = createHandoffCompletionUpdate(
			state,
			`Found ${validationResult.valid.length} code findings`,
			validationResult.valid.length,
		);

		return {
			findings: validationResult.valid,
			currentAgent: undefined,
			...handoffCompletion,
		};
	} catch (error) {
		logger.error("Code Searcher failed", { error });
		return {
			agentErrors: [
				{
					agent: "code-searcher",
					error: error instanceof Error ? error.message : String(error),
					timestamp: new Date().toISOString(),
					recoverable: true,
				},
			],
			handoffRequest: undefined,
			// Note: Don't add to unavailableGatherers - runtime errors might be recoverable
			// Set phase to analyzing to avoid getting stuck in targeted_gather
			phase: "analyzing" as SupervisorPhase,
		};
	}
}

/**
 * Search context built from preGathered logs and incident data.
 */
interface SearchContext {
	errorPatterns: string[];
	functionNames: string[];
}

/**
 * Build search context from preGathered log data and incident.
 * Prioritizes log data for accurate error patterns and function names.
 */
function buildSearchContext(state: InvestigationState): SearchContext {
	const errorPatterns: string[] = [];
	const functionNames: string[] = [];

	// Get error patterns from preGathered log preview
	const logPreview = state.preGatheredContext?.logPreview;
	if (logPreview?.errorLogs) {
		for (const log of logPreview.errorLogs) {
			// Add error messages (truncate for prompt efficiency)
			if (log.message) {
				errorPatterns.push(log.message.slice(0, 200));
			}

			// Extract function names from stack traces if present
			// This is a basic extraction - can be enhanced with language-specific parsers
			const details = (log as { stackTrace?: string });
			if (details.stackTrace) {
				const extractedFunctions = extractFunctionNames(details.stackTrace);
				functionNames.push(...extractedFunctions);
			}
		}
	}

	// Fall back to incident title/description if no log data
	if (errorPatterns.length === 0) {
		const fallbackError = extractErrorMessage(state);
		if (fallbackError !== "unknown error") {
			errorPatterns.push(fallbackError);
		}
	}

	// Deduplicate
	return {
		errorPatterns: [...new Set(errorPatterns)],
		functionNames: [...new Set(functionNames)],
	};
}

/**
 * Extract function names from stack trace text.
 * Handles common stack trace formats (Node.js, Python, etc.)
 */
function extractFunctionNames(stackTrace: string): string[] {
	const functionNames: string[] = [];

	// Node.js/JavaScript: "at functionName (file:line:col)" or "at Object.functionName"
	const jsPattern = /at\s+(?:Object\.)?(\w+)\s*[\(\[]/g;
	let match: RegExpExecArray | null;
	while ((match = jsPattern.exec(stackTrace)) !== null) {
		if (match[1] && !["anonymous", "Object", "Module", "eval"].includes(match[1])) {
			functionNames.push(match[1]);
		}
	}

	// Python: 'in functionName'
	const pyPattern = /in\s+(\w+)/g;
	while ((match = pyPattern.exec(stackTrace)) !== null) {
		if (match[1] && !["<module>"].includes(match[1])) {
			functionNames.push(match[1]);
		}
	}

	return functionNames;
}

/**
 * Extract error message from incident or alerts (fallback when no log data)
 */
function extractErrorMessage(state: InvestigationState): string {
	// Try to extract from incident title/description
	const incidentText = `${state.incident?.title || ""} ${state.incident?.description || ""}`;
	const alertText = `${state.primaryAlert?.title || ""} ${state.primaryAlert?.description || ""}`;

	// Look for common error patterns
	const patterns = [
		/Error:\s*(.+?)(?:\n|$)/i,
		/Exception:\s*(.+?)(?:\n|$)/i,
		/Failed:\s*(.+?)(?:\n|$)/i,
		/TypeError:\s*(.+?)(?:\n|$)/i,
		/ReferenceError:\s*(.+?)(?:\n|$)/i,
	];

	for (const pattern of patterns) {
		const match = incidentText.match(pattern) || alertText.match(pattern);
		if (match) {
			return match[1].trim();
		}
	}

	// Fall back to title
	return state.incident?.title || state.primaryAlert?.title || "unknown error";
}

/**
 * Extract structured findings from agent result.
 */
function extractFindingsFromAgentResult(
	messages: Array<{ content: string | unknown }>,
	source: Finding["source"],
): Finding[] {
	const findings: Finding[] = [];

	// Get the last message from the agent
	const lastMessage = messages[messages.length - 1];
	if (!lastMessage?.content) {
		return findings;
	}

	const content = typeof lastMessage.content === "string"
		? lastMessage.content
		: JSON.stringify(lastMessage.content);

	// Try to parse structured findings from the response
	try {
		const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[1]);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					findings.push({
						source,
						type: item.type || "code",
						summary: item.summary || item.description || "Code finding",
						details: item,
						relevance: item.relevance || 50,
						timestamp: item.timestamp,
					});
				}
				return findings;
			}
		}
	} catch {
		// JSON parsing failed, fall back to text extraction
	}

	// Extract file paths and create findings
	const filePathPattern = /(?:^|\s)([\w./\-]+\.[a-z]{2,5}):(\d+)/gm;
	let match: RegExpExecArray | null;

	while ((match = filePathPattern.exec(content)) !== null) {
		findings.push({
			source,
			type: "code",
			summary: `Code reference: ${match[1]}:${match[2]}`,
			details: { filePath: match[1], lineNumber: parseInt(match[2], 10) },
			relevance: 60,
		});
	}

	// If no specific findings, create a general one
	if (findings.length === 0) {
		findings.push({
			source,
			type: "code",
			summary: content.slice(0, 500),
			details: { rawResponse: content },
			relevance: 40,
		});
	}

	return findings;
}
