/**
 * LangGraph Studio Entry Point (Enhanced with Dynamic Imports)
 *
 * This file provides a parseable entry point for LangGraph Studio that uses
 * dynamic imports at runtime to call the REAL implementation.
 *
 * Why dynamic imports?
 * - The TypeScript parser only analyzes static imports
 * - Dynamic import() calls execute at runtime, bypassing parser limitations
 * - This lets us use the real @prismalens/* dependencies when running
 *
 * @see https://langchain-ai.github.io/langgraphjs/cloud/deployment/setup_javascript
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// =============================================================================
// STATE ANNOTATION (Must be inline for parser - expanded for real testing)
// =============================================================================

/**
 * State annotation that mirrors InvestigationStateAnnotation.
 * Must be inline because the parser can't resolve workspace imports.
 */
const StudioStateAnnotation = Annotation.Root({
	// Core identifiers
	investigationId: Annotation<string>({
		reducer: (_, next) => next,
		default: () => "",
	}),
	incidentId: Annotation<string>({
		reducer: (_, next) => next,
		default: () => "",
	}),

	// Incident context (required for real testing)
	incident: Annotation<{
		incidentId: string;
		title: string;
		description?: string;
		severity: string;
		priority: string;
		serviceName?: string;
		serviceId?: string;
		alertCount: number;
		tags?: string[];
		customerImpact?: string;
		correlationReason?: string;
		triggeredAt?: string;
		number?: number;
	} | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	// Alerts (array of correlated alerts)
	alerts: Annotation<Array<{
		alertId: string;
		title: string;
		description?: string;
		severity?: string;
		source?: string;
		serviceName?: string;
		serviceId?: string;
		repository?: string;
		labels?: Record<string, string>;
		triggeredAt?: string;
	}>>({
		reducer: (_, next) => next ?? [],
		default: () => [],
	}),

	primaryAlert: Annotation<{
		alertId: string;
		title: string;
		description?: string;
		severity?: string;
		source?: string;
		serviceName?: string;
		serviceId?: string;
		repository?: string;
		labels?: Record<string, string>;
		triggeredAt?: string;
	} | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	// Integrations for tool access
	integrations: Annotation<Array<{
		type: string;
		connectionId: string;
		credentials: Record<string, unknown>;
	}>>({
		reducer: (_, next) => next ?? [],
		default: () => [],
	}),

	// Status tracking
	status: Annotation<"pending" | "running" | "completed" | "failed">({
		reducer: (_, next) => next,
		default: () => "pending" as const,
	}),

	// Pre-gathered context (from preGather node)
	preGatheredContext: Annotation<Record<string, unknown> | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	// Investigation results
	hypotheses: Annotation<Array<{
		id: string;
		claim: string;
		confidence: number;
		category: string;
		evidence: string[];
		status: string;
	}>>({
		reducer: (_, next) => next ?? [],
		default: () => [],
	}),

	recommendations: Annotation<Array<{
		id: string;
		title: string;
		description: string;
		priority: string;
		category: string;
		codeChanges?: Array<{ file: string; search: string; replace: string }>;
	}>>({
		reducer: (_, next) => next ?? [],
		default: () => [],
	}),

	summary: Annotation<string | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	rootCause: Annotation<string | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	rootCauseCategory: Annotation<string | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	confidence: Annotation<number | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	error: Annotation<string | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),

	// Agent progression tracking
	agentProgression: Annotation<Record<string, boolean>>({
		reducer: (current, next) => ({ ...current, ...next }),
		default: () => ({}),
	}),

	// Data quality scores
	dataQuality: Annotation<Record<string, number>>({
		reducer: (current, next) => ({ ...current, ...next }),
		default: () => ({}),
	}),

	// Iteration tracking
	iterationCount: Annotation<number>({
		reducer: (_, next) => next,
		default: () => 0,
	}),

	// Analysis method
	analysisMethod: Annotation<string | null>({
		reducer: (_, next) => next,
		default: () => null,
	}),
});

type StudioState = typeof StudioStateAnnotation.State;

// =============================================================================
// NODE FUNCTIONS WITH DYNAMIC IMPORTS
// =============================================================================

/**
 * Validate incident - uses real validation logic via dynamic import.
 */
async function validateIncident(state: StudioState): Promise<Partial<StudioState>> {
	console.log(`[Studio] Validating investigation ${state.investigationId}`);

	// Basic validation that works without imports
	if (!state.investigationId) {
		return {
			status: "failed",
			error: "Missing investigationId in state",
			agentProgression: { validation: false },
		};
	}

	if (!state.incidentId) {
		return {
			status: "failed",
			error: "Missing incidentId in state",
			agentProgression: { validation: false },
		};
	}

	if (!state.incident) {
		return {
			status: "failed",
			error: "No incident provided for investigation",
			agentProgression: { validation: false },
		};
	}

	// Calculate data quality scores
	const dataQuality: Record<string, number> = {};

	const inc = state.incident;
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

	if (state.alerts.length > 0) {
		const alertScores = state.alerts.map((alert) => {
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
		dataQuality.alerts = alertScores.reduce((a, b) => a + b, 0) / alertScores.length;
	}

	return {
		primaryAlert: state.primaryAlert || state.alerts[0] || null,
		status: "running",
		dataQuality,
		agentProgression: { validation: true },
	};
}

/**
 * Pre-gather context - uses real preGather node via dynamic import.
 */
async function preGather(state: StudioState): Promise<Partial<StudioState>> {
	console.log(`[Studio] Pre-gathering context for ${state.investigationId}`);

	try {
		// Dynamic import bypasses parser - executes at runtime
		const preGatherModule = await import("./nodes/pre-gathering/index.js");

		// Call the real preGather function
		const result = await preGatherModule.preGather(state as never);

		console.log(`[Studio] Pre-gather complete`);
		return result as Partial<StudioState>;
	} catch (error) {
		console.error(`[Studio] Pre-gather failed:`, error);
		// Graceful degradation - continue without pre-gathered context
		return {
			preGatheredContext: null,
			agentProgression: { preGather: true },
		};
	}
}

/**
 * Commander node - runs the REAL DeepAgent investigation via dynamic import.
 */
async function commander(state: StudioState): Promise<Partial<StudioState>> {
	console.log(`[Studio] Running commander for ${state.investigationId}`);

	try {
		// Dynamic imports for commander dependencies
		const [
			{ HumanMessage },
			{ createCommanderFromState },
			{ getStoredHypotheses, getStoredRecommendations, resetHypothesisStore, resetRecommendationStore },
			stateModule,
		] = await Promise.all([
			import("@langchain/core/messages"),
			import("../agents/commander/agent.js"),
			import("../tools/index.js"),
			import("../types/state.js"),
		]);

		const { getIncidentDisplayInfo } = stateModule;

		// Reset tool stores for fresh collection
		resetHypothesisStore();
		resetRecommendationStore();

		// Create Commander with state context
		const commanderAgent = createCommanderFromState(state as never);

		// Get incident display info
		const displayInfo = getIncidentDisplayInfo(state as never);
		const incidentNumber = displayInfo.number
			? `INC-${displayInfo.number}`
			: displayInfo.incidentId;

		// Build alert summaries
		const alertSummaries = state.alerts.length > 0
			? state.alerts.map((a) =>
					`- [${a.severity?.toUpperCase() || "UNKNOWN"}] ${a.title}${a.description ? `: ${a.description}` : ""}`
				).join("\n")
			: "No individual alerts - see incident details above";

		// Build enriched context from pre-gathered data
		let enrichedContext = "";
		const preGathered = state.preGatheredContext as Record<string, unknown> | null;

		if (preGathered) {
			const preGatherModule = await import("./nodes/pre-gathering/index.js");
			const { getTopRiskyDeployments, getTopSimilarIncidents, CHANGE_RISK_THRESHOLDS, SIMILARITY_THRESHOLDS } = preGatherModule;

			const recentChanges = preGathered.recentChanges as { deployments: unknown[] } | undefined;
			if (recentChanges?.deployments) {
				const topChanges = getTopRiskyDeployments(recentChanges.deployments as never, 2);
				if (topChanges.length > 0 && topChanges[0].riskScore >= CHANGE_RISK_THRESHOLDS.HIGH) {
					enrichedContext += `\n## ⚠️ High-Risk Change Detected\nRisk score: ${topChanges[0].riskScore}%\n`;
				}
			}

			const similarIncidents = preGathered.similarIncidents as { incidents: unknown[] } | undefined;
			if (similarIncidents?.incidents) {
				const topSimilar = getTopSimilarIncidents(similarIncidents.incidents as never, 2);
				if (topSimilar.length > 0 && topSimilar[0].similarity >= SIMILARITY_THRESHOLDS.HIGH) {
					enrichedContext += `\n## 📋 Similar Past Incident Found\nSimilarity: ${topSimilar[0].similarity}%\n`;
				}
			}
		}

		// Build the initial message for Commander
		const initialMessage = `
# Incident Investigation Request

## Incident: ${incidentNumber}
- **Title**: ${displayInfo.title}
- **Severity**: ${displayInfo.severity.toUpperCase()}
- **Priority**: ${displayInfo.priority.toUpperCase()}
- **Service**: ${displayInfo.serviceName || "Unknown"}
- **Alert Count**: ${displayInfo.alertCount}
${displayInfo.description ? `- **Description**: ${displayInfo.description}` : ""}
${enrichedContext}
## Investigation Metadata
- **Investigation ID**: ${state.investigationId}

## Associated Alerts (${state.alerts.length})
${alertSummaries}

## Your Task
Investigate this incident following the standard workflow:
1. Use cartographer to gather context (logs, code, deployments)
2. Use detective to analyze and form hypothesis
3. Use surgeon to propose fixes if root cause is identified
4. Compile your findings into a final report
`;

		// Invoke Commander with real LLM
		console.log(`[Studio] Invoking commander agent...`);
		const result = await commanderAgent.invoke({
			messages: [new HumanMessage(initialMessage)],
		});

		// Extract results from tool stores
		const hypotheses = getStoredHypotheses();
		const recommendations = getStoredRecommendations();

		// Find best hypothesis
		let bestHypothesis: { claim: string; confidence: number; category?: string } | null = null;
		if (hypotheses.length > 0) {
			for (const h of hypotheses) {
				if (!bestHypothesis || h.confidence > bestHypothesis.confidence) {
					bestHypothesis = h;
				}
			}
		}

		// Extract summary from last message
		const messages = result.messages || [];
		const lastMessage = messages[messages.length - 1];
		const summary = typeof lastMessage?.content === "string" ? lastMessage.content : null;

		console.log(`[Studio] Commander complete - ${hypotheses.length} hypotheses, ${recommendations.length} recommendations`);

		return {
			hypotheses: hypotheses as unknown as StudioState["hypotheses"],
			recommendations: recommendations as unknown as StudioState["recommendations"],
			summary,
			rootCause: bestHypothesis?.claim || null,
			rootCauseCategory: bestHypothesis?.category || null,
			confidence: bestHypothesis?.confidence || null,
			agentProgression: { commander: true },
			iterationCount: state.iterationCount + 1,
		};
	} catch (error) {
		console.error(`[Studio] Commander failed:`, error);
		return {
			status: "failed",
			error: error instanceof Error ? error.message : "Commander failed unexpectedly",
			agentProgression: { commander: false },
		};
	}
}

/**
 * Write to API - finalizes investigation status.
 */
async function writeToApi(state: StudioState): Promise<Partial<StudioState>> {
	console.log(`[Studio] Finalizing investigation ${state.investigationId}`);

	const bestHypothesis = state.hypotheses.length > 0
		? state.hypotheses.reduce(
				(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
				null as StudioState["hypotheses"][0] | null,
			)
		: null;

	const hasHighConfidence = bestHypothesis && bestHypothesis.confidence >= 70;

	let status: StudioState["status"] = "completed";
	let analysisMethod = "multi_agent_investigation";

	if (state.error) {
		status = "failed";
	} else if (!hasHighConfidence) {
		analysisMethod = "inconclusive_analysis";
	}

	console.log(`[Studio] Final status: ${status}, confidence: ${bestHypothesis?.confidence || 0}%`);

	return {
		status,
		analysisMethod,
		agentProgression: { apiWriter: true },
	};
}

// =============================================================================
// ROUTING FUNCTIONS
// =============================================================================

function routeAfterValidation(state: StudioState): string {
	if (state.status === "failed") {
		return "writeToApi";
	}
	return "preGather";
}

function routeAfterPreGather(_state: StudioState): string {
	return "commander";
}

function routeAfterCommander(_state: StudioState): string {
	return "writeToApi";
}

// =============================================================================
// GRAPH FOR LANGGRAPH STUDIO
// =============================================================================

/**
 * Investigation graph for LangGraph Studio.
 *
 * Graph structure:
 * ```
 * START -> validateIncident -> preGather -> commander -> writeToApi -> END
 *              ↓ (on failure)
 *          writeToApi -> END
 * ```
 *
 * This graph uses REAL agent implementation via dynamic imports.
 * The state annotation is inline for parser compatibility, but the node
 * functions dynamically import the real @prismalens/* dependencies at runtime.
 */
const workflow = new StateGraph(StudioStateAnnotation)
	.addNode("validateIncident", validateIncident)
	.addNode("preGather", preGather)
	.addNode("commander", commander)
	.addNode("writeToApi", writeToApi)
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

/**
 * Compiled investigation graph for LangGraph Studio.
 * This export is referenced by langgraph.json.
 */
export const graph = workflow.compile();
