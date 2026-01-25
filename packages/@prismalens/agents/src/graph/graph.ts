import { HumanMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { Logger } from "@prismalens/logger";
import { createCommanderFromState } from "../agents/commander/agent.js";
import {
	getStoredHypotheses,
	getStoredRecommendations,
	resetHypothesisStore,
	resetRecommendationStore,
} from "../tools/index.js";
import {
	getBestHypothesis,
	getIncidentDisplayInfo,
	type Hypothesis,
	type InvestigationState,
	InvestigationStateAnnotation,
	type PreGatheredContext,
	type Recommendation,
} from "../types/state.js";
import {
	getCheckpointer,
	getInvocationConfig,
} from "./persistence/checkpointer.js";
import {
	preGather,
	getTopRiskyDeployments,
	getTopSimilarIncidents,
	CHANGE_RISK_THRESHOLDS,
	SIMILARITY_THRESHOLDS,
} from "./nodes/pre-gathering/index.js";

// Create logger for the investigation graph
const logger = new Logger({ context: "InvestigationGraph" });

// =============================================================================
// INVESTIGATION GRAPH
// =============================================================================
// LangGraph wrapper that provides:
// - Alert validation node (checks incoming alerts)
// - Pre-gather node (fetches context before commander - BigPanda pattern)
// - Commander node (runs DeepAgent investigation)
// - API writer node (persists results to database)
// - PostgreSQL checkpointing for durability
//
// Graph Flow:
// START → validateIncident → preGather → commander → writeToApi → END
//                 ↓ (on failure)
//            writeToApi → END
// =============================================================================

/**
 * Validation node - validates incident context.
 * This runs before the Commander to ensure we have valid input.
 * Requires an incident (incident-centric approach).
 */
async function validateIncident(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	const hasIncident = state.incident !== null;
	const hasAlerts = state.alerts.length > 0;

	logger.info(`Validating investigation ${state.investigationId}`, {
		hasIncident,
		alertCount: state.alerts.length,
	});

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

	// Must have an incident (incident-centric approach)
	if (!hasIncident) {
		return {
			status: "failed",
			error: "No incident provided for investigation",
		};
	}

	// Set primary alert from correlated alerts if not already set
	const primaryAlert = state.primaryAlert || state.alerts[0] || null;

	// Calculate data quality scores
	const dataQuality: Record<string, number> = {};

	// Calculate incident quality score if incident is present
	if (hasIncident) {
		const inc = state.incident!;
		let incidentScore = 0;
		if (inc.title) incidentScore += 20;
		if (inc.description) incidentScore += 15;
		if (inc.severity) incidentScore += 15;
		if (inc.priority) incidentScore += 10;
		if (inc.serviceName || inc.serviceId) incidentScore += 15;
		if (inc.alertCount > 0) incidentScore += 10;
		if (inc.tags && inc.tags.length > 0) incidentScore += 5;
		if (inc.customerImpact) incidentScore += 5;
		if (inc.correlationReason) incidentScore += 5;
		dataQuality.incident = incidentScore;
		logger.debug(`Incident quality score: ${incidentScore}%`);
	}

	// Calculate alert quality score if alerts are present
	if (hasAlerts) {
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
		dataQuality.alerts = avgQuality;
		logger.debug(`Alert quality score: ${avgQuality.toFixed(1)}%`);
	}

	return {
		primaryAlert,
		status: "running",
		dataQuality,
		agentProgression: { validation: true },
	};
}

/**
 * Commander node - runs the DeepAgent investigation.
 * This is where the actual investigation happens.
 * Uses incident context with correlated alerts for investigation.
 */
async function runCommander(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	logger.info(`Starting commander for investigation ${state.investigationId}`);

	// Reset tool stores for fresh collection
	resetHypothesisStore();
	resetRecommendationStore();

	try {
		// Create Commander with state context
		const commander = createCommanderFromState(state);

		// Get incident display info (prefers incident, falls back to alerts)
		const displayInfo = getIncidentDisplayInfo(state);
		const incidentNumber = displayInfo.number
			? `INC-${displayInfo.number}`
			: displayInfo.incidentId;

		// Build alert summaries for supporting context
		const alertSummaries = state.alerts.length > 0
			? state.alerts
					.map(
						(a) =>
							`- [${a.severity?.toUpperCase()}] ${a.title}${a.description ? `: ${a.description}` : ""}`,
					)
					.join("\n")
			: "No individual alerts - see incident details above";

		// Build enriched context from pre-gathered data (BigPanda pattern)
		const preGathered = state.preGatheredContext;
		let enrichedContext = "";

		if (preGathered) {
			// High-risk change warning (BigPanda pattern: 60-90% of incidents are change-related)
			const topChanges = getTopRiskyDeployments(
				preGathered.recentChanges.deployments,
				2,
			);
			if (topChanges.length > 0 && topChanges[0].riskScore >= CHANGE_RISK_THRESHOLDS.HIGH) {
				enrichedContext += `
## ⚠️ High-Risk Change Detected
A deployment with **${topChanges[0].riskScore}% risk score** occurred recently.
- **Factors**: ${topChanges[0].riskFactors.join(", ")}
${topChanges[0].url ? `- **Details**: ${topChanges[0].url}` : ""}
**Recommendation**: Investigate this change first - most incidents are change-related.
`;
			} else if (topChanges.length > 0) {
				enrichedContext += `
## 📋 Recent Changes
${topChanges.length} recent deployment(s) found with risk scores: ${topChanges.map((c) => `${c.riskScore}%`).join(", ")}
`;
			}

			// Similar incident hint (BigPanda 30% threshold)
			const topSimilar = getTopSimilarIncidents(
				preGathered.similarIncidents.incidents,
				2,
			);
			if (topSimilar.length > 0 && topSimilar[0].similarity >= SIMILARITY_THRESHOLDS.HIGH) {
				enrichedContext += `
## 📋 Similar Past Incident Found
INC-${topSimilar[0].number || topSimilar[0].incidentId} has **${topSimilar[0].similarity}% similarity**.
${topSimilar[0].resolution ? `- **Resolution**: ${topSimilar[0].resolution}` : ""}
${topSimilar[0].rootCause ? `- **Root Cause**: ${topSimilar[0].rootCause}` : ""}
${topSimilar[0].timeToResolve ? `- **Time to Resolve**: ${Math.round(topSimilar[0].timeToResolve / 60)} minutes` : ""}
`;
			} else if (topSimilar.length > 0) {
				enrichedContext += `
## 📋 Possibly Related Incidents
${topSimilar.length} incident(s) with similarity: ${topSimilar.map((s) => `${s.similarity}%`).join(", ")}
`;
			}

			// Recurring pattern warning
			if (preGathered.similarIncidents.patterns.length > 0) {
				const topPattern = preGathered.similarIncidents.patterns[0];
				enrichedContext += `
## 🔄 Recurring Issue Detected
Pattern "${topPattern.pattern}" has occurred **${topPattern.count} times** in the past 30 days.
Last occurrence: ${topPattern.lastOccurrence}
`;
			}

			// Metrics context
			if (preGathered.metrics.alertVelocity > 1) {
				enrichedContext += `
## 📊 Alert Metrics
- Alert velocity: **${preGathered.metrics.alertVelocity.toFixed(1)} alerts/minute**
- Time since first alert: **${Math.round(preGathered.metrics.timeSinceFirstAlert / 60)} minutes**
- Affected services: ${preGathered.metrics.affectedServices.join(", ") || "Unknown"}
`;
			}

			// Pre-gathered quality indicator
			const qualityPercent = (preGathered.gatheringMeta.qualityScore * 100).toFixed(0);
			enrichedContext += `
## 🔍 Pre-Gathered Context Quality: ${qualityPercent}%
Sources queried: ${preGathered.gatheringMeta.sourcesQueried.join(", ")}
${preGathered.gatheringMeta.errors.length > 0 ? `Note: Some sources had errors (${preGathered.gatheringMeta.errors.length})` : ""}
`;
		}

		// Build the initial message for Commander (incident-centric)
		const initialMessage = `
# Incident Investigation Request

## Incident: ${incidentNumber}
- **Title**: ${displayInfo.title}
- **Severity**: ${displayInfo.severity.toUpperCase()}
- **Priority**: ${displayInfo.priority.toUpperCase()}
- **Service**: ${displayInfo.serviceName || "Unknown"}
- **Alert Count**: ${displayInfo.alertCount}
${displayInfo.description ? `- **Description**: ${displayInfo.description}` : ""}
${state.incident?.customerImpact ? `- **Customer Impact**: ${state.incident.customerImpact}` : ""}
${state.incident?.correlationReason ? `- **Correlation**: ${state.incident.correlationReason}` : ""}
${enrichedContext}
## Investigation Metadata
- **Investigation ID**: ${state.investigationId}

## Associated Alerts (${state.alerts.length})
${alertSummaries}

## Available Context
- Repository: ${state.primaryAlert?.repository || "Not specified"}
- Triggered at: ${state.incident?.triggeredAt || state.primaryAlert?.triggeredAt || "Unknown"}

## Your Task
Investigate incident **${incidentNumber}** ("${displayInfo.title}") following the standard workflow:
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

		logger.info(`Commander complete`, {
			hypotheses: hypotheses.length,
			recommendations: recommendations.length,
		});

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
	} catch (error: unknown) {
		logger.error(`Commander failed`, error);

		return {
			status: "failed",
			error: error instanceof Error ? error.message : "Commander failed unexpectedly",
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
	logger.debug(`Persisting results for investigation ${state.investigationId}`);

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

	logger.info(`Final status: ${status}`, { confidence: bestHypothesis?.confidence || 0 });

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
		return "writeToApi"; // Skip preGather and commander, go straight to API to record failure
	}
	return "preGather"; // Proceed to pre-gathering phase
}

/**
 * Routing function - determines next node after pre-gathering.
 */
function routeAfterPreGather(state: InvestigationState): string {
	// Always proceed to commander after pre-gathering
	// Pre-gathering uses graceful degradation - even partial data is useful
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
 * START -> validateIncident -> preGather -> commander -> writeToApi -> END
 *              ↓ (on failure)
 *          writeToApi -> END
 * ```
 *
 * The preGather node runs before Commander to fetch context using parallel data fetching.
 * This follows the BigPanda enrichment pattern where 60-90% of incidents are change-related.
 */
export function buildInvestigationGraph() {
	const graph = new StateGraph(InvestigationStateAnnotation)
		// Add nodes
		.addNode("validateIncident", validateIncident)
		.addNode("preGather", preGather)
		.addNode("commander", runCommander)
		.addNode("writeToApi", writeToApi)

		// Add edges
		.addEdge(START, "validateIncident")
		.addConditionalEdges("validateIncident", routeAfterValidation, {
			preGather: "preGather",
			writeToApi: "writeToApi",
		})
		.addConditionalEdges("preGather", routeAfterPreGather, {
			commander: "commander",
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

	logger.info(`Starting investigation ${initialState.investigationId}`);

	const result = await graph.invoke(initialState, config);

	logger.info(`Investigation ${initialState.investigationId} completed`, { status: result.status });

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

	logger.info(`Resuming investigation ${investigationId}`);

	// Invoke with empty state - checkpointer will restore from last checkpoint
	const result = await graph.invoke({}, config);

	logger.info(`Investigation ${investigationId} resumed`, { status: result.status });

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

/**
 * Compiled graph for LangGraph Studio (langgraph.json points to this).
 * Uses in-memory checkpointing for Studio - no database required.
 */
export const investigationGraph = buildInvestigationGraph().compile();
