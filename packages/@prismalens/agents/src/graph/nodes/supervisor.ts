/**
 * Supervisor Node for Investigation Graph
 *
 * The Supervisor is the central router that decides which agent to invoke next.
 * It replaces the DeepAgents Commander with a LangGraph-native pattern that
 * supports parallel execution, handoff-based routing, and shared state.
 *
 * @see https://langchain-ai.github.io/langgraphjs/concepts/multi_agent
 */

import { Logger } from "@prismalens/logger";
import type {
	Finding,
	IntegrationContext,
	InvestigationState,
	SupervisorAgentName,
	SupervisorPhase,
} from "../../types/state.js";

const logger = new Logger({ context: "Supervisor" });

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum number of targeted gather iterations to prevent infinite loops */
const MAX_GATHER_ITERATIONS = 2;

/** Confidence threshold for proceeding to fix phase */
const FIX_CONFIDENCE_THRESHOLD = 70;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if state has observability integrations (Render, Datadog, etc.)
 */
export function hasObservabilityIntegration(
	integrations: IntegrationContext[],
): boolean {
	const observabilityTypes = ["render", "datadog", "sentry", "newrelic", "grafana"];
	return integrations.some((i) =>
		observabilityTypes.includes(i.type.toLowerCase()),
	);
}

/**
 * Check if state has code repository integration
 */
export function hasCodeIntegration(
	integrations: IntegrationContext[],
): boolean {
	const codeTypes = ["github", "gitlab", "bitbucket"];
	return integrations.some((i) => codeTypes.includes(i.type.toLowerCase()));
}

/**
 * Get the best hypothesis from findings
 */
function getBestHypothesisFromState(state: InvestigationState): {
	confidence: number;
	claim?: string;
} | null {
	if (state.hypotheses.length === 0) {
		return null;
	}
	return state.hypotheses.reduce(
		(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
		null as { confidence: number; claim?: string } | null,
	);
}

// =============================================================================
// SUPERVISOR NODE
// =============================================================================

/**
 * Supervisor node - decides which agent to invoke next.
 * This node is called after each agent completes and routes to the next agent.
 *
 * IMPORTANT: Do NOT clear handoffRequest here! The routing function needs it
 * to decide which gatherer to dispatch to. The handoff request is cleared
 * by the targeted gatherer when it processes the request.
 */
export async function supervisorNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	logger.info("Supervisor routing", {
		phase: state.phase,
		findingsCount: state.findings.length,
		hypothesesCount: state.hypotheses.length,
		gatherIterations: state.gatherIterations,
		hasHandoffRequest: !!state.handoffRequest,
	});

	// The supervisor doesn't modify state - it's mainly for routing
	// The actual routing happens in supervisorRoute
	// Handoff request is cleared by the targeted gatherer, not here
	return {};
}

// =============================================================================
// ROUTING FUNCTION
// =============================================================================

/**
 * Check if state has any cloned repositories available.
 */
export function hasClonedRepos(
	clonePaths: Record<string, string> | undefined,
): boolean {
	return !!clonePaths && Object.keys(clonePaths).length > 0;
}

/**
 * Supervisor routing function - determines which agent to invoke next.
 *
 * ARCHITECTURE: Sequential gathering with data dependencies.
 * - Log data comes from preGather (not log-gatherer)
 * - code-searcher uses preGathered logs to search for error patterns
 * - change-tracker uses code findings to correlate commits to files
 * - log-gatherer only runs for targeted requests from detective
 *
 * Returns:
 * - Single string for sequential execution
 * - "complete" to end the workflow
 */
export function supervisorRoute(
	state: InvestigationState,
): string {
	const {
		phase,
		hypotheses,
		gatherIterations,
		handoffRequest,
		clonePaths,
		agentProgression,
		unavailableGatherers = [],
	} = state;

	logger.info("Supervisor routing", {
		phase,
		findingsCount: state.findings.length,
		hypothesesCount: hypotheses.length,
		gatherIterations,
		hasHandoffRequest: !!handoffRequest,
		agentProgression,
	});

	// ==========================================================================
	// Phase 1: Sequential gathering (code-searcher → change-tracker)
	// Log data comes from preGather, not log-gatherer.
	// ==========================================================================
	if (phase === "gathering") {
		const codeComplete = agentProgression["code-searcher"] === true;
		const changeComplete = agentProgression["change-tracker"] === true;

		// 1. First: Code search (uses preGathered log data for patterns)
		if (!codeComplete) {
			if (hasClonedRepos(clonePaths)) {
				logger.info("Dispatching to code-searcher (sequential)");
				return "code-searcher";
			}
			// No clone paths - code-searcher is structurally unavailable
			// Mark as unavailable and skip to change-tracker
			logger.info("Skipping code-searcher (no clone paths)");
		}

		// 2. Second: Change tracking (uses code findings for file correlation)
		if (!changeComplete) {
			logger.info("Dispatching to change-tracker (sequential)");
			return "change-tracker";
		}

		// All gatherers complete → proceed to detective
		logger.info("Sequential gathering complete, proceeding to detective", {
			findingsCount: state.findings.length,
		});
		return "detective";
	}

	// ==========================================================================
	// Phase 2: Handle Detective's handoff request (targeted gather)
	// ==========================================================================
	// Check handoffRequest FIRST - when detective requests more data, it sets
	// both phase="targeted_gather" AND handoffRequest. We dispatch to gatherer first.
	if (handoffRequest && gatherIterations < MAX_GATHER_ITERATIONS) {
		// Don't dispatch to structurally unavailable gatherers
		if (unavailableGatherers.includes(handoffRequest.to)) {
			logger.warn("Gatherer structurally unavailable, skipping", {
				target: handoffRequest.to,
				unavailableGatherers,
			});
			// Clear handoff and return to detective
			return "detective";
		}

		logger.info("Dispatching to targeted gatherer", {
			target: handoffRequest.to,
			reason: handoffRequest.reason,
			iteration: gatherIterations,
		});
		return handoffRequest.to;
	}

	// ==========================================================================
	// Phase 3: After targeted gather completes, back to detective
	// ==========================================================================
	// Only reach here when phase is targeted_gather AND handoffRequest is cleared
	// (i.e., the gatherer has completed and cleared the request)
	if (phase === "targeted_gather") {
		logger.info("Targeted gather complete, returning to detective");
		return "detective";
	}

	// ==========================================================================
	// Phase 4: After analysis, decide: fix or complete
	// ==========================================================================
	if (phase === "analyzing") {
		const bestHypothesis = getBestHypothesisFromState(state);

		if (bestHypothesis && bestHypothesis.confidence >= FIX_CONFIDENCE_THRESHOLD) {
			logger.info("High confidence hypothesis, proceeding to surgeon", {
				confidence: bestHypothesis.confidence,
			});
			return "surgeon";
		}

		// Not confident enough, complete without fix
		logger.info("Confidence below threshold, completing without fix", {
			confidence: bestHypothesis?.confidence || 0,
			threshold: FIX_CONFIDENCE_THRESHOLD,
		});
		return "complete";
	}

	// ==========================================================================
	// Phase 5: After fixing, complete
	// ==========================================================================
	if (phase === "fixing") {
		logger.info("Fixing complete, ending workflow");
		return "complete";
	}

	// ==========================================================================
	// Fallback: complete
	// ==========================================================================
	logger.warn("Unexpected state, completing workflow", { phase });
	return "complete";
}

// =============================================================================
// AGENT NODE WRAPPERS
// =============================================================================
// These functions wrap the actual agent execution and update state.
// They are called by the LangGraph nodes.
// =============================================================================

/**
 * Create findings from pre-gathered context.
 * Used when we already have data from the preGather node.
 */
export function findingsFromPreGathered(state: InvestigationState): Finding[] {
	const findings: Finding[] = [];
	const preGathered = state.preGatheredContext;

	if (!preGathered) {
		return findings;
	}

	// Convert recent changes to findings
	for (const deployment of preGathered.recentChanges.deployments) {
		findings.push({
			source: "change-tracker",
			type: "deployment",
			summary: `Deployment ${deployment.id} with risk score ${deployment.riskScore}`,
			details: deployment,
			relevance: deployment.riskScore,
			timestamp: deployment.timestamp,
		});
	}

	for (const commit of preGathered.recentChanges.commits) {
		findings.push({
			source: "change-tracker",
			type: "commit",
			summary: `Commit ${commit.sha.slice(0, 7)}: ${commit.message}`,
			details: commit,
			relevance: 50, // Default relevance for commits
			timestamp: commit.timestamp,
		});
	}

	// Convert log preview to findings
	if (preGathered.logPreview?.errorLogs) {
		for (const log of preGathered.logPreview.errorLogs.slice(0, 10)) {
			findings.push({
				source: "log-gatherer",
				type: "log",
				summary: log.message.slice(0, 200),
				details: log,
				relevance: log.level === "error" ? 80 : 60,
				timestamp: log.timestamp,
			});
		}
	}

	return findings;
}

/**
 * Determine next phase based on current phase and agent result.
 */
export function getNextPhase(
	currentPhase: SupervisorPhase,
	agentName: SupervisorAgentName,
	hasHandoffRequest: boolean,
): SupervisorPhase {
	switch (agentName) {
		case "log-gatherer":
		case "code-searcher":
		case "change-tracker":
			// Gatherers either continue gathering or transition to analyzing
			return hasHandoffRequest ? "targeted_gather" : "gathering";
		case "detective":
			// Detective either requests more data or completes analysis
			return hasHandoffRequest ? "analyzing" : "analyzing";
		case "surgeon":
			return "fixing";
		default:
			return currentPhase;
	}
}
