import { HumanMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createCommanderFromState } from "../agents/commander/agent.js";
import {
	getStoredHypotheses,
	getStoredRecommendations,
	resetHypothesisStore,
	resetRecommendationStore,
} from "../tools/index.js";
import {
	getBestHypothesis,
	type Hypothesis,
	type InvestigationState,
	InvestigationStateAnnotation,
	type Recommendation,
} from "../types/state.js";
import {
	getCheckpointer,
	getInvocationConfig,
} from "./persistence/checkpointer.js";

// =============================================================================
// INVESTIGATION GRAPH
// =============================================================================
// LangGraph wrapper that provides:
// - Alert validation node (checks incoming alerts)
// - Commander node (runs DeepAgent investigation)
// - API writer node (persists results to database)
// - PostgreSQL checkpointing for durability
// =============================================================================

/**
 * Alert validation node - validates and enriches incoming alerts.
 * This runs before the Commander to ensure we have valid input.
 */
async function validateAlerts(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	console.log(
		`[validateAlerts] Validating ${state.alerts.length} alerts for investigation ${state.investigationId}`,
	);

	// Validate required fields
	if (!state.investigationId) {
		return {
			status: "failed",
			error: "Missing investigationId in state",
		};
	}

	if (!state.incidentId) {
		return {
			status: "failed",
			error: "Missing incidentId in state",
		};
	}

	if (state.alerts.length === 0) {
		return {
			status: "failed",
			error: "No alerts provided for investigation",
		};
	}

	// Set primary alert if not already set
	const primaryAlert = state.primaryAlert || state.alerts[0];

	// Calculate data quality score based on alert completeness
	const alertQualityScores = state.alerts.map((alert) => {
		let score = 0;
		if (alert.title) score += 20;
		if (alert.description) score += 15;
		if (alert.severity) score += 15;
		if (alert.source) score += 10;
		if (alert.serviceName || alert.serviceId) score += 15;
		if (alert.repository) score += 15;
		if (alert.labels && Object.keys(alert.labels).length > 0) score += 5;
		if (alert.triggeredAt) score += 5;
		return score;
	});

	const avgQuality =
		alertQualityScores.reduce((a, b) => a + b, 0) / alertQualityScores.length;

	console.log(
		`[validateAlerts] Alert quality score: ${avgQuality.toFixed(1)}%`,
	);

	return {
		primaryAlert,
		status: "running",
		dataQuality: { alerts: avgQuality },
		agentProgression: { validation: true },
	};
}

/**
 * Commander node - runs the DeepAgent investigation.
 * This is where the actual investigation happens.
 */
async function runCommander(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	console.log(`[runCommander] Starting investigation ${state.investigationId}`);

	// Reset tool stores for fresh collection
	resetHypothesisStore();
	resetRecommendationStore();

	try {
		// Create Commander with state context
		const commander = createCommanderFromState(state);

		// Build the initial message for Commander
		const alertSummaries = state.alerts
			.map(
				(a) =>
					`- [${a.severity}] ${a.title}${a.description ? `: ${a.description}` : ""}`,
			)
			.join("\n");

		const initialMessage = `
# Incident Investigation Request

## Incident Details
- **Investigation ID**: ${state.investigationId}
- **Incident ID**: ${state.incidentId}
- **Priority**: ${state.priority}

## Alerts (${state.alerts.length})
${alertSummaries}

## Available Context
- Primary alert service: ${state.primaryAlert?.serviceName || "Unknown"}
- Repository: ${state.primaryAlert?.repository || "Not specified"}
- Triggered at: ${state.primaryAlert?.triggeredAt || "Unknown"}

## Your Task
Investigate this incident following the standard workflow:
1. Use cartographer to gather context (logs, code, deployments)
2. Use detective to analyze and form hypothesis
3. Use surgeon to propose fixes if root cause is identified
4. Compile your findings into a final report
`;

		// Invoke Commander
		const result = await commander.invoke({
			messages: [new HumanMessage(initialMessage)],
		});

		// Extract hypotheses and recommendations from tool stores
		const hypotheses = getStoredHypotheses();
		const recommendations = getStoredRecommendations();

		// Find best hypothesis
		const bestHypothesis =
			hypotheses.length > 0
				? hypotheses.reduce(
						(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
						null as Hypothesis | null,
					)
				: null;

		// Extract final message content
		const messages = result.messages || [];
		const lastMessage = messages[messages.length - 1];
		const summary =
			typeof lastMessage?.content === "string" ? lastMessage.content : null;

		console.log(
			`[runCommander] Investigation complete. ${hypotheses.length} hypotheses, ${recommendations.length} recommendations`,
		);

		return {
			messages: result.messages,
			hypotheses,
			recommendations,
			summary,
			rootCause: bestHypothesis?.claim || null,
			rootCauseCategory: bestHypothesis?.category || null,
			confidence: bestHypothesis?.confidence || null,
			commanderResult: result,
			agentProgression: { commander: true },
			iterationCount: state.iterationCount + 1,
		};
	} catch (error: any) {
		console.error(`[runCommander] Investigation failed:`, error);

		return {
			status: "failed",
			error: error.message || "Commander failed unexpectedly",
			agentProgression: { commander: false },
		};
	}
}

/**
 * API writer node - persists investigation results to the database.
 * Called after Commander completes to save findings.
 */
async function writeToApi(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	console.log(
		`[writeToApi] Persisting results for investigation ${state.investigationId}`,
	);

	// In a real implementation, this would call the API to update:
	// - Investigation status
	// - Hypotheses/root cause
	// - Recommendations
	// - Agent executions
	//
	// For now, we just mark as complete. The actual API integration
	// happens in the processor that calls this graph.

	const bestHypothesis = getBestHypothesis(state);
	const hasHighConfidence = bestHypothesis && bestHypothesis.confidence >= 70;
	const hasRecommendations = state.recommendations.length > 0;

	// Determine final status
	let status: InvestigationState["status"] = "completed";
	let analysisMethod = "multi_agent_investigation";

	if (state.error) {
		status = "failed";
	} else if (!hasHighConfidence) {
		analysisMethod = "inconclusive_analysis";
	}

	console.log(
		`[writeToApi] Final status: ${status}, confidence: ${bestHypothesis?.confidence || 0}%`,
	);

	return {
		status,
		analysisMethod,
		agentProgression: { apiWriter: true },
	};
}

/**
 * Routing function - determines next node after validation.
 */
function routeAfterValidation(state: InvestigationState): string {
	if (state.status === "failed") {
		return "writeToApi"; // Skip commander, go straight to API to record failure
	}
	return "commander";
}

/**
 * Routing function - determines next node after commander.
 */
function routeAfterCommander(state: InvestigationState): string {
	// Always go to API writer to persist results
	return "writeToApi";
}

// =============================================================================
// GRAPH BUILDER
// =============================================================================

/**
 * Build the investigation graph.
 *
 * Graph structure:
 * ```
 * START -> validateAlerts -> [commander | writeToApi] -> writeToApi -> END
 * ```
 */
export function buildInvestigationGraph() {
	const graph = new StateGraph(InvestigationStateAnnotation)
		// Add nodes
		.addNode("validateAlerts", validateAlerts)
		.addNode("commander", runCommander)
		.addNode("writeToApi", writeToApi)

		// Add edges
		.addEdge(START, "validateAlerts")
		.addConditionalEdges("validateAlerts", routeAfterValidation, {
			commander: "commander",
			writeToApi: "writeToApi",
		})
		.addConditionalEdges("commander", routeAfterCommander, {
			writeToApi: "writeToApi",
		})
		.addEdge("writeToApi", END);

	return graph;
}

/**
 * Compile the investigation graph with PostgreSQL checkpointing.
 *
 * @example
 * const graph = await compileInvestigationGraph();
 * const result = await graph.invoke(initialState, getInvocationConfig(investigationId));
 */
export async function compileInvestigationGraph() {
	const graph = buildInvestigationGraph();
	const checkpointer = await getCheckpointer();

	return graph.compile({
		checkpointer,
	});
}

/**
 * Run a full investigation with checkpointing.
 *
 * @example
 * const result = await runInvestigation({
 *   investigationId: 'inv-123',
 *   incidentId: 'inc-456',
 *   alerts: [{ alertId: 'alert-1', title: '...', severity: 'high' }],
 *   integrations: [...],
 * });
 */
export async function runInvestigation(
	initialState: Partial<InvestigationState>,
): Promise<InvestigationState> {
	if (!initialState.investigationId) {
		throw new Error("investigationId is required");
	}

	const graph = await compileInvestigationGraph();
	const config = getInvocationConfig(initialState.investigationId);

	console.log(
		`[runInvestigation] Starting investigation ${initialState.investigationId}`,
	);

	const result = await graph.invoke(initialState, config);

	console.log(
		`[runInvestigation] Investigation ${initialState.investigationId} completed with status: ${result.status}`,
	);

	return result as InvestigationState;
}

/**
 * Resume a previously started investigation from checkpoint.
 *
 * @example
 * const result = await resumeInvestigation('inv-123');
 */
export async function resumeInvestigation(
	investigationId: string,
): Promise<InvestigationState> {
	const graph = await compileInvestigationGraph();
	const config = getInvocationConfig(investigationId);

	console.log(
		`[resumeInvestigation] Resuming investigation ${investigationId}`,
	);

	// Invoke with empty state - checkpointer will restore from last checkpoint
	const result = await graph.invoke({}, config);

	console.log(
		`[resumeInvestigation] Investigation ${investigationId} resumed with status: ${result.status}`,
	);

	return result as InvestigationState;
}

// =============================================================================
// EXPORTS FOR LANGGRAPH STUDIO
// =============================================================================

/**
 * Default compiled graph for LangGraph Studio.
 * Note: This uses environment variables for configuration.
 */
let _studioGraph: Awaited<ReturnType<typeof compileInvestigationGraph>> | null =
	null;

export async function getStudioGraph() {
	if (!_studioGraph) {
		_studioGraph = await compileInvestigationGraph();
	}
	return _studioGraph;
}

// Export the builder for studio (langgraph.json points to this)
export const investigationGraph = buildInvestigationGraph();
