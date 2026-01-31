/**
 * Surgeon Agent Node
 *
 * Proposes fixes based on the root cause hypothesis from Detective.
 * Can create code fix proposals, rollback suggestions, or configuration changes.
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
import {
	createSurgeonTools,
	getStoredRecommendations,
	resetRecommendationStore,
	resetRiskAssessmentStore,
	resetRunbookStore,
} from "../../tools/fix-proposal.js";
import type {
	Fix,
	Hypothesis,
	InvestigationState,
	Recommendation,
	SupervisorPhase,
} from "../../types/state.js";

const logger = new Logger({ context: "Surgeon" });

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const SURGEON_SYSTEM_PROMPT = `You are a Surgeon agent specializing in proposing fixes for incident resolution.

## Your Mission
Based on the root cause analysis from Detective, propose actionable fixes that address the issue.

## IMPORTANT CONSTRAINTS
- You PROPOSE fixes only - you do NOT implement them
- All proposals are for HUMAN REVIEW
- Never claim you've fixed something - you've only proposed a fix
- Be conservative - unclear fixes should be marked for investigation

## Fix Proposal Types

### 1. Code Fixes (code_fix)
For bugs and logic errors:
- searchBlock: EXACT match of current code (copy-paste from source)
- replaceBlock: Your corrected version
- testCase: How to verify the fix works

### 2. Configuration Changes (config_change)
For config issues:
- Specify the exact setting and value
- Include where to change it (env var, config file, dashboard)
- Note any dependencies or side effects

### 3. Rollbacks (rollback)
When a recent deployment is the cause:
- Use suggest_rollback tool
- Specify the service and target version
- Explain why rollback is recommended

### 4. Monitoring Improvements (monitoring)
For incidents that could have been detected earlier:
- Suggest new alerts or dashboards
- Propose threshold changes

## Workflow

1. **Review the Hypothesis**
   - Understand the root cause identified by Detective
   - Note the confidence level and evidence

2. **Search Runbooks** (if applicable)
   - Use lookup_runbook to find existing remediation procedures
   - Leverage proven solutions when available

3. **Propose Fix**
   - Use propose_fix to create the recommendation
   - Include specific details for implementation

4. **Assess Risk**
   - Use assess_change_risk to evaluate the proposed fix
   - Include required approvals in your recommendation

## Priority Guidelines
- **critical**: Production down, data loss, security issue
- **high**: Major feature broken, significant impact
- **medium**: Degraded but functional
- **low**: Minor, edge case

## Best Practices
1. One recommendation per distinct issue
2. Be specific - vague fixes aren't actionable
3. Include test/verification steps
4. Consider side effects and risks
5. If unsure, recommend investigation first
6. Check runbooks for proven solutions
7. Always assess risk before finalizing
`;

// =============================================================================
// SURGEON NODE
// =============================================================================

/**
 * Surgeon node - proposes fixes based on root cause analysis.
 *
 * This node runs a ReAct agent that can:
 * - Create fix proposals (code, config, rollback)
 * - Search runbooks for proven solutions
 * - Assess change risk
 */
export async function surgeonNode(
	state: InvestigationState,
): Promise<Partial<InvestigationState>> {
	logger.info("Surgeon starting", {
		investigationId: state.investigationId,
		hypothesesCount: state.hypotheses.length,
		confidence: state.confidence,
	});

	// Check for LLM config
	if (!state.llmConfig) {
		logger.error("No LLM config provided");
		return {
			phase: "complete" as SupervisorPhase,
			agentErrors: [
				{
					agent: "surgeon",
					error: "No LLM configuration provided",
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
		};
	}

	// Reset stores for fresh collection
	resetRecommendationStore();
	resetRiskAssessmentStore();
	resetRunbookStore();

	try {
		// Resolve LLM config for this agent
		const normalizedConfig = normalizeConfig(state.llmConfig);
		const agentConfig = resolveAgentConfig(normalizedConfig, "surgeon");
		const llm = createLLM(agentConfig);

		// Create tools for the Surgeon
		const tools = createSurgeonTools();

		// Create the ReAct agent
		const agent = createReactAgent({
			llm,
			tools,
			messageModifier: SURGEON_SYSTEM_PROMPT,
		});

		// Build the input message
		const inputMessage = buildSurgeonInput(state);

		// Invoke the agent
		const result = await agent.invoke({
			messages: [{ role: "user", content: inputMessage }],
		});

		// Extract recommendations from the store
		const recommendations = getStoredRecommendations();

		// Create Fix object from recommendations
		const fix = buildFixFromRecommendations(recommendations, state);

		logger.info("Surgeon complete", {
			recommendationsCount: recommendations.length,
			fixType: fix?.type,
			fixConfidence: fix?.confidence,
		});

		return {
			phase: "fixing" as SupervisorPhase,
			fix,
			recommendations,
			currentAgent: undefined,
			agentProgression: { surgeon: true },
		};
	} catch (error) {
		logger.error("Surgeon failed", { error });
		return {
			phase: "complete" as SupervisorPhase,
			agentErrors: [
				{
					agent: "surgeon",
					error: error instanceof Error ? error.message : String(error),
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
			agentProgression: { surgeon: false },
		};
	}
}

/**
 * Build the input message for the Surgeon agent.
 */
function buildSurgeonInput(state: InvestigationState): string {
	// Get the best hypothesis
	const bestHypothesis = state.hypotheses.reduce(
		(best, h) => (h.confidence > (best?.confidence || 0) ? h : best),
		null as Hypothesis | null,
	);

	// Build hypothesis summary
	let hypothesisSummary = "";
	if (bestHypothesis) {
		hypothesisSummary = `
## Root Cause Hypothesis (Confidence: ${bestHypothesis.confidence}%)
**Claim**: ${bestHypothesis.claim}
**Category**: ${bestHypothesis.category?.toUpperCase() || "UNKNOWN"}
**Evidence**:
${bestHypothesis.evidence.map((e, i) => `${i + 1}. ${e}`).join("\n")}
`;
	} else {
		hypothesisSummary = `
## No Root Cause Hypothesis
Detective did not form a hypothesis. Consider recommending further investigation.
`;
	}

	// Build relevant findings summary
	const relevantFindings = state.findings
		.filter((f) => f.relevance >= 50)
		.sort((a, b) => b.relevance - a.relevance)
		.slice(0, 5);

	let findingsSummary = "";
	if (relevantFindings.length > 0) {
		findingsSummary = `
## Key Findings (Relevance >= 50%)
${relevantFindings.map((f) => `- [${f.type.toUpperCase()}] ${f.summary} (${f.relevance}%)`).join("\n")}
`;
	}

	// Include high-risk deployments if available
	let deploymentsInfo = "";
	if (state.preGatheredContext) {
		const riskyDeployments = state.preGatheredContext.recentChanges.deployments.filter(
			(d) => d.riskScore >= 50,
		);
		if (riskyDeployments.length > 0) {
			deploymentsInfo = `
## High-Risk Deployments
${riskyDeployments.map((d) => `- ${d.id} (Risk: ${d.riskScore}%) - ${d.riskFactors.join(", ")}${d.url ? ` - ${d.url}` : ""}`).join("\n")}
`;
		}
	}

	return `
# Fix Proposal Request

## Incident Details
- **Investigation ID**: ${state.investigationId}
- **Title**: ${state.incident?.title || state.primaryAlert?.title || "Unknown"}
- **Severity**: ${state.incident?.severity?.toUpperCase() || "UNKNOWN"}
- **Service**: ${state.incident?.serviceName || state.primaryAlert?.serviceName || "Unknown"}

${hypothesisSummary}
${deploymentsInfo}
${findingsSummary}

## Your Task
Based on the root cause analysis above:

1. **If a clear root cause is identified (confidence >= 70%)**:
   - Search runbooks for existing remediation procedures
   - Propose a specific fix using propose_fix
   - Assess the risk of the proposed fix

2. **If confidence is moderate (50-69%)**:
   - Consider multiple fix options
   - Recommend the safest approach
   - Suggest additional investigation if needed

3. **If confidence is low (<50%)**:
   - Recommend further investigation
   - Suggest what information would help identify the root cause

Remember: You are PROPOSING fixes for human review, not implementing them.
`;
}

/**
 * Build a Fix object from the recommendations.
 */
function buildFixFromRecommendations(
	recommendations: Recommendation[],
	state: InvestigationState,
): Fix | undefined {
	if (recommendations.length === 0) {
		return undefined;
	}

	// Get the highest priority recommendation
	const priorityOrder = ["critical", "high", "medium", "low"];
	const sorted = [...recommendations].sort(
		(a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority),
	);
	const primary = sorted[0];

	// Map category to fix type
	const categoryToType: Record<string, Fix["type"]> = {
		code_fix: "code_change",
		config_change: "config_change",
		rollback: "rollback",
		monitoring: "monitoring",
		investigation: "code_change", // Default for investigation recommendations
	};

	const fix: Fix = {
		type: categoryToType[primary.category] || "code_change",
		summary: primary.title + (primary.description ? `: ${primary.description}` : ""),
		confidence: state.confidence || 50,
		effort: primary.estimatedEffort,
	};

	// Add code changes if present
	if (primary.codeChanges && primary.codeChanges.length > 0) {
		fix.codeChanges = primary.codeChanges;
	}

	// Add rollback info if this is a rollback recommendation
	if (primary.category === "rollback") {
		// Extract service name from the title or use default
		const serviceMatch = primary.title.match(/Rollback (\S+)/i);
		fix.rollbackTarget = {
			service: serviceMatch?.[1] || state.incident?.serviceName || "unknown",
			version: "previous",
			reason: primary.description || "Rollback recommended based on root cause analysis",
		};
	}

	return fix;
}
