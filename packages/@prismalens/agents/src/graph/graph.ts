/**
 * Investigation Graph - Supervisor Pattern
 *
 * LangGraph-native Supervisor Pattern for incident investigation.
 * Key features:
 *
 * 1. Parallel execution via Send API
 * 2. Handoff-based routing for agent iteration
 * 3. Shared state across all agents
 * 4. Unified LangGraph (no DeepAgents wrapper overhead)
 *
 * Graph Flow:
 * ```
 * START → validateIncident → preGather → cloneIfNeeded → supervisor ⟲ → writeToApi → END
 *                ↓ (fail)                                     ↑
 *            writeToApi                    ┌─────────────────┴──────────────────┐
 *                                         │            Supervisor Loop           │
 *                                         ├──────────────────────────────────────┤
 *                                         │  Phase 1: Parallel Gather            │
 *                                         │  ├─ log-gatherer    ─┐               │
 *                                         │  ├─ code-searcher   ─┼→ supervisor   │
 *                                         │  └─ change-tracker  ─┘               │
 *                                         │                                       │
 *                                         │  Phase 2: Analyze                     │
 *                                         │  └─ detective → supervisor            │
 *                                         │                                       │
 *                                         │  Phase 2.5: Challenge (conditional)   │
 *                                         │  └─ adversary → supervisor            │
 *                                         │                                       │
 *                                         │  Phase 3: Targeted Gather (optional)  │
 *                                         │  └─ {gatherer} → supervisor           │
 *                                         │                                       │
 *                                         │  Phase 4: Fix (if confident)          │
 *                                         │  └─ surgeon → supervisor              │
 *                                         └──────────────────────────────────────┘
 * ```
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { Logger } from "@prismalens/logger";

// Agent nodes
import { logGathererNode } from "../agents/gatherers/log-gatherer.js";
import { codeSearcherNode } from "../agents/gatherers/code-searcher.js";
import { changeTrackerNode } from "../agents/gatherers/change-tracker.js";
import { detectiveNode } from "../agents/analysis/detective.js";
import { adversaryNode } from "../agents/analysis/adversary.js";
import { surgeonNode } from "../agents/fix/surgeon.js";

// Pre-processing nodes
import { preGather } from "./nodes/pre-gathering/index.js";
import { cloneIfNeededNode } from "./nodes/pre-gathering/clone.js";

// Supervisor
import {
	supervisorNode,
	supervisorRoute,
	findingsFromPreGathered,
} from "./nodes/supervisor.js";

// Quality Gate
import { qualityGateNode, qualityGateRoute } from "./nodes/quality-gate.js";

// Handoff Processor
import {
	handoffProcessorNode,
	handoffProcessorRoute,
} from "./nodes/handoff-processor.js";

// GathererCoordinator (sub-supervisor for gatherers)
import {
	gathererCoordinatorNode,
	gathererCoordinatorRoute,
} from "./nodes/gatherer-coordinator.js";

// State and persistence
import type { DataProvider } from "../types/data-provider.js";
import type { InvestigationConfig, IntegrationResolver } from "../types/config.js";
import {
	getBestHypothesis,
	type InvestigationState,
	InvestigationStateAnnotation,
} from "../types/index.js";
import {
	getCheckpointer,
	getInvocationConfig,
} from "./persistence/checkpointer.js";

const logger = new Logger({ context: "InvestigationGraph" });

// =============================================================================
// VALIDATION NODE
// =============================================================================

/**
 * Validation node - validates incident context.
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
	}

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
	}

	return {
		primaryAlert,
		status: "running",
		dataQuality,
	};
}

// =============================================================================
// WRITE TO API NODE
// =============================================================================

/**
 * API writer node - persists investigation results.
 */
async function writeToApi(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	logger.debug(`Persisting results for investigation ${state.investigationId}`);

	const bestHypothesis = getBestHypothesis(state);
	const hasHighConfidence = bestHypothesis && bestHypothesis.confidence >= 70;
	const hasFix = state.fix !== undefined;

	// Determine final status
	let status: InvestigationState["status"] = "completed";
	let analysisMethod = "supervisor_pattern_investigation";

	if (state.error || state.agentErrors.length > 0) {
		// Check if any errors are non-recoverable
		const hasCriticalError = state.agentErrors.some((e) => !e.recoverable);
		if (state.error || hasCriticalError) {
			status = "failed";
		}
	}

	if (status !== "failed") {
		if (!hasHighConfidence) {
			analysisMethod = "inconclusive_analysis";
		} else if (hasFix) {
			analysisMethod = "fix_proposed";
		}
	}

	logger.info(`Final status: ${status}`, {
		confidence: bestHypothesis?.confidence || 0,
		findingsCount: state.findings.length,
		hypothesesCount: state.hypotheses.length,
		recommendationsCount: state.recommendations.length,
		hasFix,
	});

	return {
		status,
		analysisMethod,
		phase: "complete",
	};
}

// =============================================================================
// PRE-SUPERVISOR PREPARATION NODE
// =============================================================================

/**
 * Prepare for supervisor - converts pre-gathered context to findings format.
 * This bridges the pre-gather phase with the supervisor loop.
 */
async function prepareSupervisor(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	const hasClonedRepos = state.clonePaths && Object.keys(state.clonePaths).length > 0;

	logger.info("Preparing for supervisor loop", {
		investigationId: state.investigationId,
		hasPreGatheredContext: !!state.preGatheredContext,
		hasClonedRepos,
		clonedServices: state.clonePaths ? Object.keys(state.clonePaths) : [],
	});

	// Convert pre-gathered context to findings
	const initialFindings = findingsFromPreGathered(state);

	return {
		findings: initialFindings,
		phase: "gathering",
		currentAgent: undefined,
	};
}

// =============================================================================
// ROUTING FUNCTIONS
// =============================================================================

function routeAfterValidation(state: InvestigationState): string {
	if (state.status === "failed") {
		return "writeToApi";
	}
	return "preGather";
}

function routeAfterPreGather(_state: InvestigationState): string {
	return "cloneIfNeeded";
}

function routeAfterClone(_state: InvestigationState): string {
	return "prepareSupervisor";
}

function routeAfterPrepareSupervisor(_state: InvestigationState): string {
	return "supervisor";
}

/**
 * Route after detective: to processHandoff if requesting data, to adversary for dialogue, or back to supervisor.
 */
function routeAfterDetective(state: InvestigationState): string {
	// If detective made a handoff request, route directly to processor
	if (state.handoffRequest) {
		logger.info("Routing detective to processHandoff for handoff validation");
		return "processHandoff";
	}

	// Check if detective flagged for direct adversary dialogue
	if (state.needsAdversaryChallenge) {
		logger.info("Routing detective directly to adversary for dialogue");
		return "adversary";
	}

	// Default: back to supervisor for orchestration
	return "supervisor";
}

/**
 * Route after adversary: back to detective for refinement, or to supervisor.
 */
function routeAfterAdversary(state: InvestigationState): string {
	// Check if adversary requests detective to refine hypothesis
	if (state.adversaryRequestsRefinement) {
		logger.info("Routing adversary back to detective for refinement");
		return "detective";
	}

	// Default: back to supervisor for orchestration
	return "supervisor";
}

// =============================================================================
// GRAPH BUILDER
// =============================================================================

/**
 * Build the investigation graph with Supervisor Pattern.
 *
 * Graph structure:
 * ```
 * START → validateIncident → preGather → cloneIfNeeded → prepareSupervisor → supervisor ⟲ → writeToApi → END
 *              ↓ (fail)                                                            ↑
 *          writeToApi                                               ┌──────────────┴──────────────┐
 *                                                                   │      Supervisor Loop         │
 *                                                                   │ (parallel gatherers, then    │
 *                                                                   │  detective, then surgeon)    │
 *                                                                   └─────────────────────────────┘
 * ```
 *
 * @internal This function is not exported to avoid TypeScript declaration portability issues.
 *           Use `investigationGraph` for LangGraph Studio or `runInvestigation()` for programmatic use.
 */
function buildInvestigationGraph() {
	const graph = new StateGraph(InvestigationStateAnnotation)
		// Pre-processing nodes
		.addNode("validateIncident", validateIncident)
		.addNode("preGather", preGather)
		.addNode("cloneIfNeeded", cloneIfNeededNode)
		.addNode("prepareSupervisor", prepareSupervisor)

		// Supervisor node
		.addNode("supervisor", supervisorNode)

		// Quality gate node (validates findings before Detective)
		.addNode("qualityGate", qualityGateNode)

		// Handoff processor node (handles handoff validation and denial feedback)
		.addNode("processHandoff", handoffProcessorNode)

		// GathererCoordinator (sub-supervisor for gatherers)
		.addNode("gatherer-coordinator", gathererCoordinatorNode)

		// Gatherer agent nodes
		.addNode("log-gatherer", logGathererNode)
		.addNode("code-searcher", codeSearcherNode)
		.addNode("change-tracker", changeTrackerNode)

		// Analysis and fix agent nodes
		.addNode("detective", detectiveNode)
		.addNode("adversary", adversaryNode)
		.addNode("surgeon", surgeonNode)

		// Output node
		.addNode("writeToApi", writeToApi)

		// Pre-processing edges
		.addEdge(START, "validateIncident")
		.addConditionalEdges("validateIncident", routeAfterValidation, {
			preGather: "preGather",
			writeToApi: "writeToApi",
		})
		.addConditionalEdges("preGather", routeAfterPreGather, {
			cloneIfNeeded: "cloneIfNeeded",
		})
		.addConditionalEdges("cloneIfNeeded", routeAfterClone, {
			prepareSupervisor: "prepareSupervisor",
		})
		.addConditionalEdges("prepareSupervisor", routeAfterPrepareSupervisor, {
			supervisor: "supervisor",
		})

		// Supervisor routing (the heart of the pattern)
		// Note: Supervisor routes to gatherer-coordinator, not directly to gatherers
		.addConditionalEdges("supervisor", supervisorRoute, {
			"gatherer-coordinator": "gatherer-coordinator",
			processHandoff: "processHandoff",
			qualityGate: "qualityGate",
			detective: "detective",
			adversary: "adversary",
			surgeon: "surgeon",
			complete: "writeToApi",
		})

		// GathererCoordinator routes to individual gatherers or back to supervisor
		.addConditionalEdges("gatherer-coordinator", gathererCoordinatorRoute, {
			"log-gatherer": "log-gatherer",
			"code-searcher": "code-searcher",
			"change-tracker": "change-tracker",
			processHandoff: "processHandoff",
			supervisor: "supervisor",
		})

		// All gatherers return through gatherer-coordinator
		.addEdge("log-gatherer", "gatherer-coordinator")
		.addEdge("code-searcher", "gatherer-coordinator")
		.addEdge("change-tracker", "gatherer-coordinator")

		// Quality gate routes conditionally: to supervisor (re-gather) or detective (analyze)
		.addConditionalEdges("qualityGate", qualityGateRoute, {
			supervisor: "supervisor",
			detective: "detective",
		})

		// Handoff processor routes: denied → detective (with feedback), valid → supervisor
		.addConditionalEdges("processHandoff", handoffProcessorRoute, {
			detective: "detective",
			supervisor: "supervisor",
		})

		// Detective routes: to processHandoff for handoff requests, to adversary for dialogue, or back to supervisor
		.addConditionalEdges("detective", routeAfterDetective, {
			processHandoff: "processHandoff",
			adversary: "adversary",
			supervisor: "supervisor",
		})

		// Adversary routes: direct back to detective for refinement, or back to supervisor
		.addConditionalEdges("adversary", routeAfterAdversary, {
			detective: "detective",
			supervisor: "supervisor",
		})

		.addEdge("surgeon", "supervisor")

		// Output
		.addEdge("writeToApi", END);

	return graph;
}

/**
 * Compile the investigation graph with PostgreSQL checkpointing.
 *
 * @internal This function is not exported to avoid TypeScript declaration portability issues.
 *           Use `runInvestigation()` or `resumeInvestigation()` for programmatic use.
 */
async function compileInvestigationGraph() {
	const graph = buildInvestigationGraph();
	const checkpointer = await getCheckpointer();

	return graph.compile({
		checkpointer,
	});
}

/**
 * Run a full investigation.
 *
 * SECURITY: Only non-sensitive config (provider, model, maxIterations, priority)
 * enters the LangGraph execution path. API keys are resolved from process.env
 * by the LLM factory. Integration credentials are resolved on-demand via
 * connectionIds. This prevents credential leaks via LangSmith traces,
 * checkpoints, or error handlers.
 *
 * @param initialState - Initial state for the investigation (data only, no credentials)
 * @param dataProvider - Provider for fetching additional data during investigation
 * @param runtimeConfig - Runtime config (maxIterations, priority) - NO credentials
 *
 * @example
 * const result = await runInvestigation(
 *   {
 *     investigationId: 'inv-123',
 *     incidentId: 'inc-456',
 *     incident: { ... },
 *     alerts: [{ alertId: 'alert-1', title: '...', severity: 'high' }],
 *   },
 *   dataProvider,
 *   {
 *     maxIterations: 10,
 *     priority: 'normal',
 *   },
 * );
 */
export async function runInvestigation(
	initialState: Partial<InvestigationState>,
	dataProvider: DataProvider,
	runtimeConfig: InvestigationConfig,
): Promise<InvestigationState> {
	if (!initialState.investigationId) {
		throw new Error("investigationId is required");
	}

	if (!initialState.incidentId) {
		throw new Error("incidentId is required");
	}

	if (!initialState.incident) {
		throw new Error("incident context is required");
	}

	const graph = await compileInvestigationGraph();
	const baseConfig = getInvocationConfig(
		initialState.investigationId,
		runtimeConfig,
		initialState.incidentId,
	);

	// Build integration resolver (closure over credentials — not serializable)
	const integrations = runtimeConfig.integrations || [];
	const integrationResolver: IntegrationResolver = {
		async resolve(connectionIds?: string[]) {
			if (!connectionIds?.length) return integrations;
			return integrations.filter((i) => connectionIds.includes(i.connectionId));
		},
	};

	// Merge dataProvider + integrationResolver into configurable
	// Both are class/object instances — not serializable, won't appear in traces
	const config = {
		...baseConfig,
		configurable: {
			...baseConfig.configurable,
			dataProvider,
			integrationResolver,
		},
	};

	logger.info(`Starting investigation ${initialState.investigationId}`);

	const result = await graph.invoke(initialState, config);

	logger.info(`Investigation ${initialState.investigationId} completed`, {
		status: result.status,
		phase: result.phase,
		findingsCount: result.findings.length,
		hypothesesCount: result.hypotheses.length,
	});

	return result as InvestigationState;
}

/**
 * Resume a previously started investigation.
 *
 * @param investigationId - ID of the investigation to resume
 * @param dataProvider - Provider for fetching additional data during investigation
 * @param runtimeConfig - Runtime config (maxIterations, priority) - NO credentials
 */
export async function resumeInvestigation(
	investigationId: string,
	dataProvider: DataProvider,
	runtimeConfig: InvestigationConfig,
): Promise<InvestigationState> {
	const graph = await compileInvestigationGraph();
	const baseConfig = getInvocationConfig(investigationId, runtimeConfig);

	// Build integration resolver (closure over credentials — not serializable)
	const integrations = runtimeConfig.integrations || [];
	const integrationResolver: IntegrationResolver = {
		async resolve(connectionIds?: string[]) {
			if (!connectionIds?.length) return integrations;
			return integrations.filter((i) => connectionIds.includes(i.connectionId));
		},
	};

	// Merge dataProvider + integrationResolver into configurable
	const config = {
		...baseConfig,
		configurable: {
			...baseConfig.configurable,
			dataProvider,
			integrationResolver,
		},
	};

	logger.info(`Resuming investigation ${investigationId}`);

	const result = await graph.invoke({}, config);

	logger.info(`Investigation ${investigationId} resumed`, {
		status: result.status,
		phase: result.phase,
	});

	return result as InvestigationState;
}

// =============================================================================
// EXPORTS FOR LANGGRAPH STUDIO
// =============================================================================

/**
 * Compiled graph for LangGraph Studio (uses in-memory checkpointing).
 *
 * Note: LangGraph Studio may show a type portability warning during compilation.
 * This is a known limitation with LangGraph's complex generic types and doesn't
 * affect functionality.
 */
export const investigationGraph = buildInvestigationGraph().compile();
