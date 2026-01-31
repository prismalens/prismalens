/**
 * Log Gatherer Agent Node
 *
 * Fetches logs from observability platforms (Render, Datadog, etc.)
 * and produces findings for the investigation.
 *
 * This is a LangGraph node that runs a ReAct agent internally.
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Logger } from "@prismalens/logger";
import {
	createLLM,
	normalizeConfig,
	resolveAgentConfig,
} from "../../llm/factory.js";
import { createToolsForAgent } from "../../tools/factory.js";
import type {
	Finding,
	InvestigationState,
	SupervisorPhase,
} from "../../types/state.js";

const logger = new Logger({ context: "LogGatherer" });

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const LOG_GATHERER_SYSTEM_PROMPT = `You are a Log Gatherer agent specializing in fetching and analyzing logs from observability platforms.

## Your Mission
Gather relevant log data from available platforms (Render, Datadog, Sentry, etc.) to help investigate the incident.

## What You Should Do
1. Fetch logs from around the incident time (±15 minutes)
2. Focus on error and warning level logs
3. Look for patterns, stack traces, and error messages
4. Identify the sequence of events leading to the issue

## Output Format
Return your findings as structured data that can be analyzed by the Detective agent:
- Focus on ERROR and WARN level logs
- Extract key error messages and stack traces
- Note any patterns or recurring issues
- Include timestamps for correlation

## Constraints
- You are READ-ONLY - you cannot modify logs or configurations
- Focus on logs relevant to the incident time window
- Be efficient - don't fetch excessive amounts of data
- Summarize findings, don't dump raw logs

## Available Context
- Incident time: Look at logs from 15 minutes before to now
- Service name: Focus on logs from affected services
- Error patterns: Search for error-related keywords
`;

// =============================================================================
// LOG GATHERER NODE
// =============================================================================

/**
 * Log Gatherer node - fetches logs from observability platforms.
 *
 * IMPORTANT: Log-gatherer only runs for TARGETED requests from detective.
 * Initial log data comes from preGather, not this agent.
 *
 * This node runs a ReAct agent to gather log data and produces
 * findings that are added to the investigation state.
 */
export async function logGathererNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	logger.info("Log Gatherer starting", {
		investigationId: state.investigationId,
		phase: state.phase,
		hasHandoffRequest: !!state.handoffRequest,
	});

	// Log-gatherer should only run for targeted requests from detective
	// Initial log data comes from preGather, not this agent
	const isTargetedRequest = state.phase === "targeted_gather" && state.handoffRequest?.to === "log-gatherer";

	if (!isTargetedRequest) {
		logger.warn("log-gatherer called outside targeted request context, skipping");
		return {
			handoffRequest: undefined,
			agentProgression: { "log-gatherer": true },
		};
	}

	// Get the targeted query from handoffRequest
	const targetedQuery = state.handoffRequest?.context || "";

	// Check for LLM config
	if (!state.llmConfig) {
		logger.error("No LLM config provided");
		return {
			agentErrors: [
				{
					agent: "log-gatherer",
					error: "No LLM configuration provided",
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
			handoffRequest: undefined,
			phase: "analyzing" as SupervisorPhase,
			agentProgression: { "log-gatherer": false },
		};
	}

	try {
		// Resolve LLM config for this agent
		const normalizedConfig = normalizeConfig(state.llmConfig);
		const agentConfig = resolveAgentConfig(normalizedConfig, "cartographer");
		const llm = createLLM(agentConfig);

		// Create tools for log gathering
		// Log gatherer typically uses API-based tools (Render, Datadog, etc.)
		// but we pass clonePaths in case local log files need to be read
		const tools = createToolsForAgent("cartographer", state.integrations, {
			clonePaths: state.clonePaths,
		});

		// Create the ReAct agent
		const agent = createReactAgent({
			llm,
			tools,
			messageModifier: LOG_GATHERER_SYSTEM_PROMPT,
		});

		// Build the input message with targeted query from detective
		const incidentTime = state.incident?.triggeredAt || new Date().toISOString();
		const serviceName = state.incident?.serviceName || state.primaryAlert?.serviceName || "unknown";

		const inputMessage = `
## Targeted Log Search Request

The detective agent has requested additional log data:
**Query**: ${targetedQuery}
**Reason**: ${state.handoffRequest?.reason || "Additional investigation needed"}

## Incident Context
- Incident ID: ${state.investigationId}
- Service: ${serviceName}
- Incident Time: ${incidentTime}
- Severity: ${state.incident?.severity || "unknown"}
- Description: ${state.incident?.description || state.primaryAlert?.description || "No description"}

## Your Task
Focus specifically on the detective's query above. Search for:
1. Logs matching the requested pattern
2. Related error messages and stack traces
3. Temporal context around the incident time

Please gather the requested log data and summarize your findings.
`;

		// Invoke the agent
		const result = await agent.invoke({
			messages: [{ role: "user", content: inputMessage }],
		});

		// Extract findings from agent response
		const findings = extractFindingsFromAgentResult(result.messages, "log-gatherer");

		logger.info("Log Gatherer complete", {
			findingsCount: findings.length,
		});

		return {
			findings,
			// Clear handoff request if this was a targeted gather
			handoffRequest: undefined,
			currentAgent: undefined,
			agentProgression: { "log-gatherer": true },
		};
	} catch (error) {
		logger.error("Log Gatherer failed", { error });
		return {
			agentErrors: [
				{
					agent: "log-gatherer",
					error: error instanceof Error ? error.message : String(error),
					timestamp: new Date().toISOString(),
					recoverable: true,
				},
			],
			handoffRequest: undefined,
			// Set phase to analyzing to avoid getting stuck in targeted_gather
			phase: "analyzing" as SupervisorPhase,
			agentProgression: { "log-gatherer": false },
		};
	}
}

/**
 * Extract structured findings from agent result.
 * Parses the agent's response and creates Finding objects.
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
	// The agent should output findings in a structured format
	try {
		// Look for JSON blocks in the response
		const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[1]);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					findings.push({
						source,
						type: item.type || "log",
						summary: item.summary || item.message || "Log finding",
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

	// Fall back to creating a single finding from the text response
	findings.push({
		source,
		type: "log",
		summary: content.slice(0, 500),
		details: { rawResponse: content },
		relevance: 50,
		timestamp: new Date().toISOString(),
	});

	return findings;
}
