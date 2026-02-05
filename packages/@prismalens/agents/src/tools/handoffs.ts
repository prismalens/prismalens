/**
 * Handoff Tools for Agent-to-Agent Communication
 *
 * These tools enable agents to request additional data from other agents.
 * The handoff request is stored in state and processed by the Supervisor.
 *
 * Supports generalized handoffs (any agent to any agent) with capability validation.
 *
 * @example
 * // Detective requests more log data
 * const result = await handoff.invoke({
 *   to: "log-gatherer",
 *   reason: "Need to see what happened before the error started",
 *   context: "Get logs from 10 minutes before the incident",
 * });
 */

import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { HANDOFF_AGENT_NAMES, type HandoffRequest, type HandoffAgentName } from "../types/index.js";

// =============================================================================
// HANDOFF SCHEMA
// =============================================================================

/**
 * All valid handoff target agents (derived from canonical HANDOFF_AGENT_NAMES)
 */
const HandoffTargetSchema = z.enum(HANDOFF_AGENT_NAMES);

/**
 * Schema for the universal handoff tool
 */
const HandoffSchema = z.object({
	to: HandoffTargetSchema.describe("Target agent to hand off to"),
	reason: z.string().describe("Why this handoff is needed"),
	context: z.string().describe("Specific query or context for the target agent"),
	todoId: z.string().optional().describe("Related todo ID if task-driven"),
	priority: z
		.enum(["normal", "urgent"])
		.optional()
		.default("normal")
		.describe("Priority of the handoff"),
});

/**
 * Schema for the detective-specific request_more_data tool.
 * Simpler than HandoffSchema - only gatherers, with query instead of context.
 */
const RequestMoreDataSchema = z.object({
	gatherer: z
		.enum(["log-gatherer", "code-searcher", "change-tracker"])
		.describe("Which gatherer agent should fetch the additional data"),
	query: z
		.string()
		.describe("Specific question or search query for the gatherer. Be precise."),
	reason: z
		.string()
		.describe("Why this additional data is needed for the hypothesis"),
});

// =============================================================================
// HANDOFF STORE
// =============================================================================

/**
 * Storage for the handoff request.
 * The graph will extract this after the agent completes.
 */
let pendingHandoffRequest: HandoffRequest | null = null;

/**
 * Get the pending handoff request (call after agent completes)
 */
export function getPendingHandoffRequest(): HandoffRequest | null {
	return pendingHandoffRequest;
}

/**
 * Reset the handoff request store (call at start of each agent invocation)
 */
export function resetHandoffRequest(): void {
	pendingHandoffRequest = null;
}

/**
 * Set a handoff request programmatically (for use by graph nodes)
 */
export function setHandoffRequest(request: HandoffRequest): void {
	pendingHandoffRequest = request;
}

// =============================================================================
// UNIVERSAL HANDOFF TOOL
// =============================================================================

/**
 * Create the universal handoff tool for any agent.
 * This tool allows any agent to request handoff to any other agent.
 *
 * @param fromAgent - The agent using this tool (source of handoff)
 */
export function createHandoffTool(
	fromAgent: HandoffAgentName,
): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = HandoffSchema.parse(input);

				// Store the handoff request for the supervisor to process
				pendingHandoffRequest = {
					from: fromAgent,
					to: validated.to as HandoffAgentName,
					reason: validated.reason,
					context: validated.context,
					todoId: validated.todoId,
					priority: validated.priority,
				};

				return JSON.stringify(
					{
						status: "handoff_requested",
						from: fromAgent,
						to: validated.to,
						reason: validated.reason,
						priority: validated.priority,
						message: `Handoff to ${validated.to} recorded. The supervisor will route your request.`,
						guidance:
							validated.to === "supervisor"
								? "Control returned to supervisor for orchestration."
								: `The ${validated.to} will be invoked with your context.`,
					},
					null,
					2,
				);
			} catch (error) {
				if (error instanceof z.ZodError) {
					return JSON.stringify({
						status: "error",
						error: "Invalid handoff request",
						details: error.errors,
					});
				}
				return JSON.stringify({
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		{
			name: "handoff",
			description: `Request handoff to another agent. Use this to delegate work or request assistance.

AVAILABLE TARGETS:
- log-gatherer: Fetch logs from observability platforms
- code-searcher: Search codebase for patterns (requires cloned repos)
- change-tracker: Get deployment/commit history
- detective: Form hypotheses from findings
- adversary: Challenge hypotheses, check scope alignment
- surgeon: Propose fixes (requires hypothesis with ≥70% confidence)
- gatherer-coordinator: Route to multiple gatherers
- supervisor: Return control to orchestrator

WHEN TO USE:
- Need data from a specific gatherer
- Need analysis from detective
- Need hypothesis validation from adversary
- Ready to propose a fix (hand to surgeon)
- Task complete, return to supervisor

EXAMPLE:
handoff({
  to: "adversary",
  reason: "Validate hypothesis scope alignment",
  context: "Check if the hypothesis addresses the original incident symptoms"
})`,
			schema: HandoffSchema,
		},
	);
}

// =============================================================================
// DETECTIVE-SPECIFIC REQUEST MORE DATA TOOL
// =============================================================================

/**
 * Create the request_more_data tool for the Detective agent.
 *
 * This is a simplified handoff tool specifically for Detective to request
 * additional data from gatherers. It has a simpler schema than the generic
 * createHandoffTool (gatherer, query, reason vs to, context, reason, todoId, priority).
 *
 * Use createHandoffTool for other agents that need full handoff capabilities.
 */
export function createRequestMoreDataTool(): StructuredTool {
	return tool(
		async (input) => {
			try {
				const validated = RequestMoreDataSchema.parse(input);

				// Store the handoff request for the supervisor to process
				pendingHandoffRequest = {
					from: "detective", // This tool is detective-specific
					to: validated.gatherer,
					reason: validated.reason,
					context: validated.query,
				};

				return JSON.stringify(
					{
						status: "handoff_requested",
						target: validated.gatherer,
						query: validated.query,
						message: `Request recorded. The ${validated.gatherer} will be invoked with your query.`,
						guidance: "Continue analyzing current findings. The additional data will be available in the next iteration.",
					},
					null,
					2,
				);
			} catch (error) {
				if (error instanceof z.ZodError) {
					return JSON.stringify({
						status: "error",
						error: "Invalid request format",
						details: error.errors,
					});
				}
				return JSON.stringify({
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		{
			name: "request_more_data",
			description: `Request additional data from a specific gatherer when current findings are insufficient.

USE THIS WHEN:
- You need more context to form a confident hypothesis
- The current findings don't cover a specific area you want to investigate
- You want to trace a specific error path or code flow

AVAILABLE GATHERERS:
- log-gatherer: Fetch logs from observability platforms (Render, Datadog, etc.)
- code-searcher: Search codebase for patterns, error origins, related code
- change-tracker: Get deployment history, recent commits, config changes

EXAMPLE QUERIES:
- "Search for all usages of the DatabaseConnection class"
- "Get logs from 10 minutes before the incident timestamp"
- "Find commits that modified the auth middleware"

NOTE: You can only request one additional gather per iteration. Make it count.`,
			schema: RequestMoreDataSchema,
		},
	);
}

// =============================================================================
// ANALYZE FINDINGS TOOL
// =============================================================================

/**
 * Schema for the analyze_findings tool
 */
const AnalyzeFindingsSchema = z.object({
	findingsToAnalyze: z
		.array(z.number())
		.describe("Indices of findings to analyze (0-based)"),
	analysisType: z
		.enum(["correlation", "timeline", "impact", "root_cause"])
		.describe("Type of analysis to perform"),
	context: z
		.string()
		.optional()
		.describe("Additional context for the analysis"),
});

/**
 * Create the analyze_findings tool for the Detective agent.
 *
 * This tool helps Detective structure their analysis of gathered findings.
 */
export function createAnalyzeFindingsTool(): StructuredTool {
	return tool(
		async (input) => {
			const { findingsToAnalyze, analysisType, context } =
				AnalyzeFindingsSchema.parse(input);

			// This is a "thinking" tool that helps structure analysis
			// The actual analysis is done by the LLM
			return JSON.stringify(
				{
					status: "analysis_ready",
					analysisType,
					findingsCount: findingsToAnalyze.length,
					guidance: {
						correlation: "Look for patterns across multiple findings. Consider timing, services, and error types.",
						timeline: "Arrange findings chronologically. Identify the sequence of events leading to the incident.",
						impact: "Assess the blast radius. Which services were affected? What's the customer impact?",
						root_cause: "Trace back from symptoms to cause. What changed? What broke? Why?",
					}[analysisType],
					context: context || "No additional context provided",
				},
				null,
				2,
			);
		},
		{
			name: "analyze_findings",
			description: `Structure your analysis of gathered findings.

USE THIS TO:
- Correlate findings across different sources
- Build a timeline of events
- Assess impact and blast radius
- Trace root cause from symptoms

This helps you think through the findings systematically before forming a hypothesis.`,
			schema: AnalyzeFindingsSchema,
		},
	);
}

// =============================================================================
// CORRELATE EVENTS TOOL
// =============================================================================

/**
 * Schema for the correlate_events tool
 */
const CorrelateEventsSchema = z.object({
	events: z
		.array(
			z.object({
				timestamp: z.string().describe("ISO timestamp of the event"),
				type: z.string().describe("Type of event (log, deployment, commit, etc.)"),
				description: z.string().describe("Brief description of the event"),
				source: z.string().optional().describe("Source of the event"),
			}),
		)
		.describe("Events to correlate"),
	windowMinutes: z
		.number()
		.default(15)
		.describe("Time window in minutes for correlation"),
});

/**
 * Create the correlate_events tool for the Detective agent.
 *
 * This tool helps identify temporal correlations between events.
 */
export function createCorrelateEventsTool(): StructuredTool {
	return tool(
		async (input) => {
			const { events, windowMinutes } = CorrelateEventsSchema.parse(input);

			// Sort events by timestamp
			const sortedEvents = [...events].sort(
				(a, b) =>
					new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
			);

			// Find clusters of events within the time window
			const clusters: Array<{ events: typeof events; startTime: string; endTime: string }> = [];
			let currentCluster: typeof events = [];
			let clusterStart: Date | null = null;

			for (const event of sortedEvents) {
				const eventTime = new Date(event.timestamp);

				if (clusterStart === null) {
					clusterStart = eventTime;
					currentCluster = [event];
				} else {
					const deltaMs = eventTime.getTime() - clusterStart.getTime();
					const deltaMinutes = deltaMs / (1000 * 60);

					if (deltaMinutes <= windowMinutes) {
						currentCluster.push(event);
					} else {
						// Save current cluster and start new one
						if (currentCluster.length > 0) {
							clusters.push({
								events: currentCluster,
								startTime: clusterStart.toISOString(),
								endTime: currentCluster[currentCluster.length - 1].timestamp,
							});
						}
						clusterStart = eventTime;
						currentCluster = [event];
					}
				}
			}

			// Save final cluster
			if (currentCluster.length > 0 && clusterStart) {
				clusters.push({
					events: currentCluster,
					startTime: clusterStart.toISOString(),
					endTime: currentCluster[currentCluster.length - 1].timestamp,
				});
			}

			return JSON.stringify(
				{
					status: "correlated",
					totalEvents: events.length,
					clusters: clusters.map((c) => ({
						eventCount: c.events.length,
						startTime: c.startTime,
						endTime: c.endTime,
						types: [...new Set(c.events.map((e) => e.type))],
						summary: c.events.map((e) => e.description).join(" → "),
					})),
					guidance:
						clusters.length > 1
							? "Multiple event clusters found. Look for causal relationships between clusters."
							: clusters.length === 1 && clusters[0].events.length > 1
								? "Events are clustered together. Likely related - look for causation."
								: "Events are spread out. May not be directly related.",
				},
				null,
				2,
			);
		},
		{
			name: "correlate_events",
			description: `Correlate events to find temporal patterns.

USE THIS TO:
- Identify events that happened close together
- Find potential cause-effect relationships
- Build a timeline of the incident

Provide events with timestamps and the tool will cluster them by time proximity.`,
			schema: CorrelateEventsSchema,
		},
	);
}

// =============================================================================
// EXPORT ALL HANDOFF TOOLS
// =============================================================================

/**
 * Create all handoff and analysis tools for the Detective agent
 */
export function createHandoffTools(): StructuredTool[] {
	return [
		createRequestMoreDataTool(),
		createAnalyzeFindingsTool(),
		createCorrelateEventsTool(),
	];
}
