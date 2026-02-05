/**
 * Detective Agent Node
 *
 * Analyzes gathered findings to form hypotheses about the root cause.
 * Can request additional data from gatherers via handoff requests.
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
import { handoffManager } from "../../utils/handoff-manager.js";
import { buildTraceConfig, mergeTraceConfig } from "../../utils/tracing.js";
import type {
	Finding,
	Hypothesis,
	InvestigationState,
	SupervisorPhase,
} from "../../types/index.js";
import { getInvestigationConfigFromConfigurable } from "../../types/config.js";

const logger = new Logger({ context: "Detective" });

// =============================================================================
// ADVERSARY DIALOGUE CONSTANTS
// =============================================================================

/** High confidence threshold that triggers adversary dialogue */
const HIGH_CONFIDENCE_THRESHOLD = 85;

/** Thin evidence threshold - trigger if evidence count is at or below this */
const THIN_EVIDENCE_THRESHOLD = 2;

// =============================================================================
// ADVERSARY DIALOGUE LOGIC
// =============================================================================

/**
 * Determine if detective should trigger direct dialogue with adversary.
 *
 * Triggers when:
 * - High confidence hypothesis (>=85%) with thin evidence (<=2 items)
 * - This is a potential "error entrenchment" scenario
 * - Adversary challenge can validate or refine the hypothesis
 *
 * Skips when:
 * - No hypothesis formed
 * - Already low confidence (adversary won't help)
 * - Strong evidence base (no need for challenge)
 * - Already been challenged (adversaryComplete = true)
 */
function shouldTriggerAdversaryDialogue(
	bestHypothesis: Hypothesis | null,
	state: InvestigationState,
): boolean {
	// No hypothesis to challenge
	if (!bestHypothesis) {
		return false;
	}

	// Already been challenged - check adversaryChallenges array instead of agentProgression
	if (state.adversaryChallenges.length > 0) {
		return false;
	}

	const { confidence, evidence } = bestHypothesis;
	const evidenceCount = evidence?.length || 0;

	// High confidence with thin evidence = entrenchment risk
	if (confidence >= HIGH_CONFIDENCE_THRESHOLD && evidenceCount <= THIN_EVIDENCE_THRESHOLD) {
		logger.info("Triggering direct adversary dialogue", {
			confidence,
			evidenceCount,
			reason: "High confidence with thin evidence",
		});
		return true;
	}

	return false;
}

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
	config?: RunnableConfig,
): Promise<Partial<InvestigationState>> {
	const finalAnalysisOnly = state.finalAnalysisOnly || false;

	// Build trace config for this node
	const traceConfig = buildTraceConfig(state, finalAnalysisOnly ? "Final Analysis" : undefined);

	logger.info("Detective starting", {
		investigationId: state.investigationId,
		findingsCount: state.findings.length,
		gatherIterations: state.gatherIterations,
		finalAnalysisOnly,
		runName: traceConfig.runName,
	});

	// Get runtime config from RunnableConfig.configurable (NOT from state)
	const runtimeConfig = getInvestigationConfigFromConfigurable(
		config?.configurable as Record<string, unknown> | undefined,
	);

	// Check for LLM config
	if (!runtimeConfig?.llmConfig) {
		logger.error("No LLM config provided in RunnableConfig.configurable");
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
		// Resolve LLM config for this agent (from config, not state)
		const normalizedConfig = normalizeConfig(runtimeConfig.llmConfig);
		const agentConfig = resolveAgentConfig(normalizedConfig, "detective");
		const llm = createLLM(agentConfig);

		// Create tools for the Detective
		// In final analysis mode, only provide hypothesis tools (no data requests)
		const hypothesisTools = createDetectiveTools();
		let tools = [...hypothesisTools];

		if (!finalAnalysisOnly) {
			const handoffTools = createHandoffTools();
			tools = [...hypothesisTools, ...handoffTools];
		} else {
			logger.info("Final analysis mode - handoff tools disabled");
		}

		// Create the agent with todo list middleware
		const agent = createAgent({
			model: llm,
			tools,
			systemPrompt: DETECTIVE_SYSTEM_PROMPT,
		});

		// Build the input message with findings
		const inputMessage = buildDetectiveInput(state, finalAnalysisOnly);

		// Invoke the agent with trace config
		await agent.invoke(
			{ messages: [{ role: "user", content: inputMessage }] },
			mergeTraceConfig(config, traceConfig),
		);

		// Extract hypotheses from the hypothesis store
		let hypotheses = getStoredHypotheses();

		// Check for handoff request
		const handoffRequest = getPendingHandoffRequest();

		// Determine next phase
		let phase: SupervisorPhase = "analyzing";
		let gatherIterations = state.gatherIterations;

		// In final analysis mode, always go to analyzing (ignore any handoff requests)
		if (finalAnalysisOnly) {
			// Add fallback hypothesis if no hypothesis formed in final analysis mode
			if (hypotheses.length === 0) {
				logger.warn("Final analysis mode: no hypothesis formed, adding fallback");
				hypotheses = [{
					claim: "Root cause could not be determined with available data",
					confidence: 20,
					evidence: state.findings.slice(0, 5).map(f => f.summary),
					category: "unknown",
					timestamp: new Date().toISOString(),
				}];
			}
			logger.info("Final analysis complete, proceeding to analyzing phase", {
				hypothesesCount: hypotheses.length,
			});
			// Clear any accidental handoff request (shouldn't happen since tools are hidden)
		} else if (handoffRequest) {
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

		// Check if we should trigger direct adversary challenge
		// Conditions: high confidence (>=85%) with thin evidence (<=2)
		const needsAdversaryChallenge = shouldTriggerAdversaryDialogue(
			bestHypothesis,
			state,
		);

		logger.info("Detective complete", {
			hypothesesCount: hypotheses.length,
			bestConfidence: bestHypothesis?.confidence,
			hasHandoffRequest: !!handoffRequest,
			needsAdversaryChallenge,
		});

		return {
			phase,
			hypotheses,
			// In final analysis mode, ignore any handoff request
			handoffRequest: finalAnalysisOnly ? undefined : (handoffRequest || undefined),
			gatherIterations,
			rootCause: bestHypothesis?.claim || null,
			rootCauseCategory: bestHypothesis?.category || null,
			confidence: bestHypothesis?.confidence || null,
			currentAgent: undefined,
			// Clear the final analysis flag
			finalAnalysisOnly: false,
			// Set flag for direct adversary dialogue
			needsAdversaryChallenge,
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
		};
	}
}

/**
 * Build the input message for the Detective agent.
 * Includes incident context and all gathered findings.
 *
 * @param state Investigation state
 * @param finalAnalysisOnly If true, detective MUST form hypotheses (no data requests)
 */
function buildDetectiveInput(state: InvestigationState, finalAnalysisOnly: boolean = false): string {
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

	// Build handoff visibility section (only if not in final analysis mode)
	const handoffSection = finalAnalysisOnly ? "" : buildHandoffSection(state);

	// Task instructions depend on mode
	const taskSection = finalAnalysisOnly
		? `## ⚠️ FINAL ANALYSIS MODE

**You have reached the data gathering limit. You MUST now form your conclusions.**

**REQUIRED**: Use the \`form_hypothesis\` tool to record your root cause analysis.
- Even if evidence is incomplete, form your BEST hypothesis with available data
- Assign an appropriate confidence level (lower if uncertain)
- You CANNOT request more data - only hypothesis formation is available

## Your Task
1. Analyze ALL the findings gathered above
2. **MUST**: Call \`form_hypothesis\` at least once with your best conclusion
3. If uncertain, form multiple hypotheses with different confidence levels
4. Provide your reasoning for each hypothesis`
		: `## Your Task
1. Analyze the findings above
2. Form hypotheses about the root cause using the form_hypothesis tool
3. If you need more information, use request_more_data (only from AVAILABLE gatherers)
4. Provide your analysis and reasoning`;

	return `
# Incident Investigation

## Incident Details
- **Title**: ${incidentInfo.title}
- **Description**: ${incidentInfo.description}
- **Severity**: ${(incidentInfo as { severity?: string }).severity?.toUpperCase() || "UNKNOWN"}
- **Triggered At**: ${(incidentInfo as { triggeredAt?: string }).triggeredAt || "Unknown"}
- **Service**: ${state.incident?.serviceName || state.primaryAlert?.serviceName || "Unknown"}

${preGatheredHints}

${handoffSection}

## Gathered Findings (${state.findings.length} total)
${findingsSummary || "No findings gathered yet."}

${taskSection}
`;
}

/**
 * Build handoff visibility section for detective prompt.
 * Shows: available targets, unavailable targets with reasons, and denial history.
 */
function buildHandoffSection(state: InvestigationState): string {
	const capabilities = {
		clonePaths: !!state.clonePaths && Object.keys(state.clonePaths).length > 0,
	};

	// Get available and unavailable targets
	const available = handoffManager.getAvailableTargets("detective", capabilities);
	const unavailable = handoffManager.getUnavailableTargets("detective", capabilities);

	// Get denial history and completions
	const handoffHistory = state.handoffHistory || [];
	const denials = handoffHistory.filter((h) => h.status === "denied");
	const completions = handoffHistory.filter((h) => h.status === "completed");

	let section = `## Data Request Capabilities\n\n`;

	// Available gatherers
	if (available.length > 0) {
		section += `**Available Gatherers:**\n`;
		section += available
			.map((t) => `- **${t.to}**: ${t.description || "Available"}`)
			.join("\n");
		section += "\n\n";
	}

	// Unavailable gatherers (upfront constraint visibility)
	if (unavailable.length > 0) {
		section += `**⚠️ Unavailable Gatherers (DO NOT REQUEST):**\n`;
		section += unavailable.map((t) => `- **${t.to}**: ${t.reason}`).join("\n");
		section += `\n\n⚠️ **IMPORTANT**: Do NOT request data from unavailable gatherers. Form your hypothesis with current findings or request from available gatherers only.\n\n`;
	}

	// Previous denials (feedback from past requests)
	if (denials.length > 0) {
		const lastDenial = denials[denials.length - 1];
		section += `**⚠️ Previous Request Denied:**\n`;
		section += `Your request to **${lastDenial.to}** was denied: ${lastDenial.denialReason}\n`;
		section += `You should form a hypothesis with current findings or request from a different gatherer.\n\n`;
	}

	// Completed handoffs (context about what data was already gathered)
	if (completions.length > 0) {
		section += `**Completed Data Requests:**\n`;
		section += completions
			.map(
				(h) =>
					`- **${h.to}**: ${h.resultSummary || "Completed"} (${h.findingsAdded || 0} findings added)`,
			)
			.join("\n");
		section += "\n\n";
	}

	// Iteration info
	const totalHandoffs = handoffHistory.length;
	const remainingHandoffs = Math.max(0, 5 - totalHandoffs);
	section += `**Gather Budget:** ${remainingHandoffs} more data requests allowed.\n`;

	return section;
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
