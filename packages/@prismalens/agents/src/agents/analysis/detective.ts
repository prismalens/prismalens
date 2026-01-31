/**
 * Detective Agent Node
 *
 * Analyzes gathered findings to form hypotheses about the root cause.
 * Can request additional data from gatherers via handoff requests.
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
import { createDetectiveTools } from "../../tools/hypothesis.js";
import {
	createHandoffTools,
	getPendingHandoffRequest,
	resetHandoffRequest,
} from "../../tools/handoffs.js";
import {
	getStoredHypotheses,
	resetHypothesisStore,
} from "../../tools/index.js";
import type {
	Finding,
	Hypothesis,
	InvestigationState,
	SupervisorPhase,
} from "../../types/state.js";

const logger = new Logger({ context: "Detective" });

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const DETECTIVE_SYSTEM_PROMPT = `You are a Detective agent specializing in root cause analysis for incident investigation.

## Your Mission
Analyze the gathered findings to identify the root cause of the incident.

## Critical Insight: Check Changes First!
**60-90% of incidents are caused by changes.** Before deep analysis:
1. Look for deployments within the last 4 hours before the incident
2. High-risk changes (score 50+) are primary suspects
3. Correlate change timing with incident timing

## Analysis Framework

### 1. Timeline Analysis
- When did the incident start?
- What changed around that time?
- Is there correlation with deployments, config changes, or external events?

### 2. Error Analysis
- What is the exact error?
- Where in the code does it originate?
- What conditions trigger it?

### 3. Pattern Recognition
- Have we seen similar issues before?
- Does the error pattern suggest a specific category?
- Are there multiple related errors?

## Forming Hypotheses

Use the **form_hypothesis** tool to record your conclusions:

### Confidence Guidelines
- **90-100%**: You have direct evidence (stack trace, error message matches code, config diff)
- **70-89%**: Strong circumstantial evidence, timing correlation
- **50-69%**: Some supporting evidence but gaps remain
- **Below 50%**: Speculation, needs more investigation

### Categories
- **code**: Bug, logic error, null pointer, race condition
- **config**: Wrong settings, missing env var, threshold issue
- **infrastructure**: Resource limits, network, disk
- **external**: Third-party API, dependency failure

## Requesting More Data

If the current findings are insufficient, use **request_more_data** to ask a gatherer for specific information:
- log-gatherer: Get more logs (specify time range, service, log level)
- code-searcher: Search for specific code patterns
- change-tracker: Get more deployment or commit history

**Limit**: You can request more data up to 2 times per investigation.

## Output

1. Form at least one hypothesis using the form_hypothesis tool
2. If uncertain, form multiple hypotheses with different confidence levels
3. Always explain your reasoning
`;

// =============================================================================
// DETECTIVE NODE
// =============================================================================

/**
 * Detective node - analyzes findings and forms hypotheses.
 *
 * This node runs a ReAct agent that can:
 * - Analyze the gathered findings
 * - Form hypotheses about root cause
 * - Request additional data from gatherers
 */
export async function detectiveNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	logger.info("Detective starting", {
		investigationId: state.investigationId,
		findingsCount: state.findings.length,
		gatherIterations: state.gatherIterations,
	});

	// Check for LLM config
	if (!state.llmConfig) {
		logger.error("No LLM config provided");
		return {
			phase: "complete" as SupervisorPhase,
			agentErrors: [
				{
					agent: "detective",
					error: "No LLM configuration provided",
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
		};
	}

	// Reset stores for fresh collection
	resetHypothesisStore();
	resetHandoffRequest();

	try {
		// Resolve LLM config for this agent
		const normalizedConfig = normalizeConfig(state.llmConfig);
		const agentConfig = resolveAgentConfig(normalizedConfig, "detective");
		const llm = createLLM(agentConfig);

		// Create tools for the Detective
		const hypothesisTools = createDetectiveTools();
		const handoffTools = createHandoffTools();
		const tools = [...hypothesisTools, ...handoffTools];

		// Create the ReAct agent
		const agent = createReactAgent({
			llm,
			tools,
			messageModifier: DETECTIVE_SYSTEM_PROMPT,
		});

		// Build the input message with findings
		const inputMessage = buildDetectiveInput(state);

		// Invoke the agent
		const result = await agent.invoke({
			messages: [{ role: "user", content: inputMessage }],
		});

		// Extract hypotheses from the hypothesis store
		const hypotheses = getStoredHypotheses();

		// Check for handoff request
		const handoffRequest = getPendingHandoffRequest();

		// Determine next phase
		let phase: SupervisorPhase = "analyzing";
		let gatherIterations = state.gatherIterations;

		if (handoffRequest) {
			phase = "targeted_gather";
			gatherIterations = state.gatherIterations + 1;
			logger.info("Detective requested more data", {
				target: handoffRequest.to,
				reason: handoffRequest.reason,
				iteration: gatherIterations,
			});
		}

		// Get best hypothesis for state update
		const bestHypothesis = hypotheses.reduce(
			(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
			null as Hypothesis | null,
		);

		logger.info("Detective complete", {
			hypothesesCount: hypotheses.length,
			bestConfidence: bestHypothesis?.confidence,
			hasHandoffRequest: !!handoffRequest,
		});

		return {
			phase,
			hypotheses,
			handoffRequest: handoffRequest || undefined,
			gatherIterations,
			rootCause: bestHypothesis?.claim || null,
			rootCauseCategory: bestHypothesis?.category || null,
			confidence: bestHypothesis?.confidence || null,
			currentAgent: undefined,
			agentProgression: { detective: true },
		};
	} catch (error) {
		logger.error("Detective failed", { error });
		return {
			phase: "complete" as SupervisorPhase,
			agentErrors: [
				{
					agent: "detective",
					error: error instanceof Error ? error.message : String(error),
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
			agentProgression: { detective: false },
		};
	}
}

/**
 * Build the input message for the Detective agent.
 * Includes incident context and all gathered findings.
 */
function buildDetectiveInput(state: InvestigationState): string {
	const incidentInfo = state.incident || {
		title: state.primaryAlert?.title || "Unknown",
		description: state.primaryAlert?.description || "No description",
		severity: state.primaryAlert?.severity || "unknown",
		triggeredAt: state.primaryAlert?.triggeredAt || new Date().toISOString(),
	};

	// Group findings by source
	const findingsBySource = groupFindingsBySource(state.findings);

	// Build findings summary
	let findingsSummary = "";

	if (findingsBySource["change-tracker"].length > 0) {
		findingsSummary += `
## Recent Changes (Change Tracker)
${formatFindings(findingsBySource["change-tracker"])}
`;
	}

	if (findingsBySource["log-gatherer"].length > 0) {
		findingsSummary += `
## Log Analysis (Log Gatherer)
${formatFindings(findingsBySource["log-gatherer"])}
`;
	}

	if (findingsBySource["code-searcher"].length > 0) {
		findingsSummary += `
## Code Analysis (Code Searcher)
${formatFindings(findingsBySource["code-searcher"])}
`;
	}

	// Include pre-gathered context hints if available
	let preGatheredHints = "";
	if (state.preGatheredContext) {
		const pg = state.preGatheredContext;

		// High-risk deployments
		const riskyDeployments = pg.recentChanges.deployments.filter(
			(d) => d.riskScore >= 50,
		);
		if (riskyDeployments.length > 0) {
			preGatheredHints += `
⚠️ **High-Risk Deployments Detected**:
${riskyDeployments.map((d) => `- ${d.id} (Risk: ${d.riskScore}%) - ${d.riskFactors.join(", ")}`).join("\n")}
`;
		}

		// Similar past incidents
		const similarIncidents = pg.similarIncidents.incidents.filter(
			(i) => i.similarity >= 50,
		);
		if (similarIncidents.length > 0) {
			preGatheredHints += `
📋 **Similar Past Incidents**:
${similarIncidents.map((i) => `- INC-${i.number || i.incidentId} (${i.similarity}% similar)${i.resolution ? ` - Resolution: ${i.resolution}` : ""}`).join("\n")}
`;
		}
	}

	return `
# Incident Investigation

## Incident Details
- **Title**: ${incidentInfo.title}
- **Description**: ${incidentInfo.description}
- **Severity**: ${(incidentInfo as { severity?: string }).severity?.toUpperCase() || "UNKNOWN"}
- **Triggered At**: ${(incidentInfo as { triggeredAt?: string }).triggeredAt || "Unknown"}
- **Service**: ${state.incident?.serviceName || state.primaryAlert?.serviceName || "Unknown"}

${preGatheredHints}

## Gathered Findings (${state.findings.length} total)
${findingsSummary || "No findings gathered yet."}

## Gather Iteration
This is iteration ${state.gatherIterations + 1}. You can request up to 2 additional gather operations if needed.

## Your Task
1. Analyze the findings above
2. Form hypotheses about the root cause using the form_hypothesis tool
3. If you need more information, use request_more_data (up to 2 times total)
4. Provide your analysis and reasoning
`;
}

/**
 * Group findings by their source agent
 */
function groupFindingsBySource(findings: Finding[]): Record<Finding["source"], Finding[]> {
	const groups: Record<Finding["source"], Finding[]> = {
		"log-gatherer": [],
		"code-searcher": [],
		"change-tracker": [],
	};

	for (const finding of findings) {
		groups[finding.source].push(finding);
	}

	// Sort each group by relevance (highest first)
	for (const group of Object.values(groups)) {
		group.sort((a, b) => b.relevance - a.relevance);
	}

	return groups;
}

/**
 * Format findings for the input message
 */
function formatFindings(findings: Finding[]): string {
	if (findings.length === 0) {
		return "No findings from this source.";
	}

	return findings
		.slice(0, 10) // Limit to top 10 by relevance
		.map((f, i) => {
			const relevanceEmoji = f.relevance >= 70 ? "🔴" : f.relevance >= 50 ? "🟡" : "🟢";
			return `${i + 1}. ${relevanceEmoji} [${f.type.toUpperCase()}] ${f.summary} (Relevance: ${f.relevance}%)${f.timestamp ? ` - ${f.timestamp}` : ""}`;
		})
		.join("\n");
}
