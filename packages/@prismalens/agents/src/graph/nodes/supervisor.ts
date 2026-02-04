/**
 * Supervisor Node for Investigation Graph
 *
 * The Supervisor is the central router that decides which agent to invoke next.
 * Uses simple findings-based routing without todo tracking.
 *
 * Routing is based on:
 * - Phase (gathering, analyzing, fixing)
 * - Findings count (from gatherers)
 * - Hypothesis presence (from detective)
 * - Agent completion tracking via agentProgress
 *
 * @see https://langchain-ai.github.io/langgraphjs/concepts/multi_agent
 */

import { Logger } from "@prismalens/logger";
import { shouldChallengeHypothesis } from "../../agents/analysis/adversary.js";
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
 * Check if state has any cloned repositories available.
 */
export function hasClonedRepos(
	clonePaths: Record<string, string> | undefined,
): boolean {
	return !!clonePaths && Object.keys(clonePaths).length > 0;
}

/**
 * Get the best hypothesis from state
 */
function getBestHypothesisFromState(state: InvestigationState): {
	confidence: number;
	claim?: string;
} | null {
	if (state.hypotheses.length === 0) return null;
	return state.hypotheses.reduce(
		(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
		null as { confidence: number; claim?: string } | null,
	);
}

/**
 * Check if code-searcher has produced findings.
 */
function hasCodeSearcherFindings(findings: Finding[]): boolean {
	return findings.some((f) => f.source === "code-searcher");
}

/**
 * Check if change-tracker has produced findings.
 */
function hasChangeTrackerFindings(findings: Finding[]): boolean {
	return findings.some((f) => f.source === "change-tracker");
}

// =============================================================================
// SUPERVISOR NODE
// =============================================================================

/**
 * Supervisor node - decides which agent to invoke next.
 * This node is called after each agent completes and routes to the next agent.
 *
 * Uses simple state-based routing:
 * - Check findings to determine if gatherers have completed
 * - Check hypotheses to determine if detective has completed
 * - Route based on phase and available data
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

	// No state modifications needed - routing is handled by supervisorRoute
	return {};
}

// =============================================================================
// ROUTING FUNCTION
// =============================================================================

/**
 * Supervisor routing function - determines which agent to invoke next.
 *
 * ARCHITECTURE: Sequential gathering with data dependencies.
 * - Log data comes from preGather (not log-gatherer)
 * - code-searcher uses preGathered logs to search for error patterns
 * - change-tracker uses code findings to correlate commits to files
 * - log-gatherer only runs for targeted requests from detective
 *
 * ROUTING BASED ON:
 * - Phase-based logic
 * - Findings presence (gatherers done when they produce findings)
 * - Hypothesis presence (detective done when hypothesis formed)
 *
 * Returns:
 * - Single string for sequential execution
 * - "complete" to end the workflow
 */
export function supervisorRoute(state: InvestigationState): string {
	const {
		phase,
		hypotheses,
		findings,
		gatherIterations,
		handoffRequest,
		clonePaths,
		adversaryChallenges,
	} = state;

	// Check agent completion via findings/state
	const codeComplete = !hasClonedRepos(clonePaths) || hasCodeSearcherFindings(findings);
	const changeComplete = hasChangeTrackerFindings(findings);
	const adversaryComplete = adversaryChallenges.length > 0;

	logger.info("Supervisor routing", {
		phase,
		findingsCount: findings.length,
		hypothesesCount: hypotheses.length,
		gatherIterations,
		hasHandoffRequest: !!handoffRequest,
		codeComplete,
		changeComplete,
		adversaryComplete,
	});

	// ==========================================================================
	// Phase 1: Sequential gathering (code-searcher → change-tracker)
	// ==========================================================================
	if (phase === "gathering") {
		// 1. First: Code search (uses preGathered log data for patterns)
		if (!codeComplete && hasClonedRepos(clonePaths)) {
			logger.info("Dispatching to gatherer-coordinator for code-searcher");
			return "gatherer-coordinator";
		}

		// 2. Second: Change tracking (uses code findings for file correlation)
		if (!changeComplete) {
			logger.info("Dispatching to gatherer-coordinator for change-tracker");
			return "gatherer-coordinator";
		}

		// All gatherers complete → proceed to quality gate
		logger.info("Gathering complete, proceeding to quality gate", {
			findingsCount: findings.length,
		});
		return "qualityGate";
	}

	// ==========================================================================
	// Phase 2: Handle validated handoff request (targeted gather)
	// ==========================================================================
	if (handoffRequest) {
		logger.info("Dispatching validated handoff to gatherer-coordinator", {
			target: handoffRequest.to,
			reason: handoffRequest.reason,
			iteration: gatherIterations,
		});
		return "gatherer-coordinator";
	}

	// ==========================================================================
	// Phase 3: After targeted gather completes, back to detective
	// ==========================================================================
	if (phase === "targeted_gather") {
		logger.info("Targeted gather complete, returning to detective");
		return "detective";
	}

	// ==========================================================================
	// Phase 4: After analysis, decide: adversary, fix, or complete
	// ==========================================================================
	if (phase === "analyzing") {
		const bestHypothesis = getBestHypothesisFromState(state);

		// Check if Adversary should challenge the hypothesis (only once)
		if (!adversaryComplete && shouldChallengeHypothesis(state)) {
			logger.info("Routing to adversary for hypothesis challenge", {
				confidence: bestHypothesis?.confidence,
			});
			return "adversary";
		}

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

/**
 * Create findings from pre-gathered context.
 */
export function findingsFromPreGathered(state: InvestigationState): Finding[] {
	const findings: Finding[] = [];
	const preGathered = state.preGatheredContext;

	if (!preGathered) return findings;

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
			relevance: 50,
			timestamp: commit.timestamp,
		});
	}

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
			return hasHandoffRequest ? "targeted_gather" : "gathering";
		case "detective":
			return hasHandoffRequest ? "analyzing" : "analyzing";
		case "surgeon":
			return "fixing";
		default:
			return currentPhase;
	}
}
