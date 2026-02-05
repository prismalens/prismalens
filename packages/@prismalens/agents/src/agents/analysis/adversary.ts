/**
 * Adversary Agent Node (Devil's Advocate)
 *
 * Challenges hypotheses using Socratic questioning to prevent error entrenchment.
 * Selectively invoked based on confidence + evidence mismatch signals.
 *
 * Research basis:
 * - iMAD (2024): Selective debate triggers prevent overturning correct answers
 * - ACL 2024: Debate only helps with novel/complex scenarios
 * - Devil's Advocate (2024): Anticipatory reflection improves outcomes
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
import {
	createAdversaryTools,
	createChallengeContext,
	getStoredChallenges,
	type AdversaryChallenge,
} from "../../tools/challenge.js";
import {
	createOversightTools,
	resetOversightStore,
	getScopeAlignmentResults,
	getScopeCreepFlags,
	getProgressAuditResults,
} from "../../tools/oversight.js";
import { buildTraceConfig, mergeTraceConfig } from "../../utils/tracing.js";
import {
	getBestHypothesis,
	type Hypothesis,
	type InvestigationState,
	type SupervisorPhase,
} from "../../types/index.js";
import { getInvestigationConfigFromConfigurable } from "../../types/config.js";

const logger = new Logger({ context: "Adversary" });

// =============================================================================
// GATING THRESHOLDS
// =============================================================================
// Based on iMAD, ACL 2024, and Devil's Advocate research.
// These thresholds determine when to invoke the Adversary.
// =============================================================================

/** Skip challenge if confidence is below this (already uncertain) */
const CONFIDENCE_THRESHOLD_LOW = 70;

/** High confidence requiring thin evidence check (entrenchment risk) */
const CONFIDENCE_THRESHOLD_HIGH = 85;

/** Strong evidence count - skip challenge if >= this */
const EVIDENCE_STRONG_THRESHOLD = 4;

/** Thin evidence count - trigger challenge if <= this */
const EVIDENCE_THIN_THRESHOLD = 2;

/** Multi-service threshold - trigger challenge if >= this */
const MULTI_SERVICE_THRESHOLD = 3;

/** Confidence threshold for circumstantial evidence check */
const CONFIDENCE_CIRCUMSTANTIAL = 75;

/** Patterns indicating direct evidence (stack traces, error messages, etc.) */
const DIRECT_EVIDENCE_PATTERNS = [
	/\bstack\s*trace\b/i,
	/\berror\s*message\b/i,
	/\bconfig\s*diff\b/i,
	/\bexception\b/i,
];

// =============================================================================
// SELECTIVE GATING LOGIC
// =============================================================================
// Challenge when: high confidence + thin evidence (entrenchment risk)
// Skip when: already uncertain, strong evidence, simple errors
// =============================================================================

/**
 * Determine if the Adversary should challenge the current hypothesis.
 * Returns true if challenge is warranted, false to skip.
 *
 * Triggering signals (from research):
 * - High confidence (>=85%) but thin evidence (<=2 items): Entrenchment risk
 * - Multi-service incident (>=3 services): Complex scenario
 * - Ambiguous category ("unknown"): Unclear root cause
 * - Only circumstantial evidence: No direct proof
 *
 * Skip signals:
 * - Low confidence (<70%): Already uncertain, no value
 * - Strong evidence (>=4 items): Well-supported hypothesis
 * - Simple single error: Obvious issue
 */
export function shouldChallengeHypothesis(state: InvestigationState): boolean {
	const bestHypothesis = getBestHypothesis(state);
	if (!bestHypothesis) {
		logger.info("No hypothesis to challenge");
		return false;
	}

	const { confidence, evidence, category } = bestHypothesis;
	const evidenceCount = evidence?.length || 0;

	// SKIP: Already uncertain - no value in challenging
	if (confidence < CONFIDENCE_THRESHOLD_LOW) {
		logger.info("Skipping challenge: confidence below threshold", {
			confidence,
			threshold: CONFIDENCE_THRESHOLD_LOW,
		});
		return false;
	}

	// SKIP: Strong evidence - well-supported hypothesis
	if (evidenceCount >= EVIDENCE_STRONG_THRESHOLD) {
		logger.info("Skipping challenge: strong evidence base", {
			evidenceCount,
			threshold: EVIDENCE_STRONG_THRESHOLD,
		});
		return false;
	}

	// TRIGGER: High confidence but thin evidence (entrenchment risk)
	if (confidence >= CONFIDENCE_THRESHOLD_HIGH && evidenceCount <= EVIDENCE_THIN_THRESHOLD) {
		logger.info("Triggering challenge: high confidence with thin evidence", {
			confidence,
			evidenceCount,
		});
		return true;
	}

	// TRIGGER: Multi-service incident (complexity)
	const affectedServices =
		state.preGatheredContext?.metrics?.affectedServices || [];
	if (affectedServices.length >= MULTI_SERVICE_THRESHOLD) {
		logger.info("Triggering challenge: multi-service incident", {
			affectedServicesCount: affectedServices.length,
		});
		return true;
	}

	// TRIGGER: Ambiguous category
	if (category === "unknown") {
		logger.info("Triggering challenge: ambiguous category");
		return true;
	}

	// TRIGGER: Only circumstantial evidence (no direct proof)
	const hasDirectEvidence =
		evidence?.some((e) =>
			DIRECT_EVIDENCE_PATTERNS.some((pattern) => pattern.test(e)),
		) || false;

	if (!hasDirectEvidence && confidence >= CONFIDENCE_CIRCUMSTANTIAL) {
		logger.info("Triggering challenge: circumstantial evidence only", {
			confidence,
			hasDirectEvidence,
		});
		return true;
	}

	logger.info("Skipping challenge: no trigger conditions met", {
		confidence,
		evidenceCount,
		category,
	});
	return false;
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const ADVERSARY_SYSTEM_PROMPT = `You are the Strategic Oversight agent (Adversary/Devil's Advocate) for incident investigation.

## Your Mission

You have TWO critical responsibilities:
1. **Hypothesis Challenge**: Ensure hypotheses are robust and well-supported
2. **Big Picture Alignment**: Keep the investigation focused on the ORIGINAL incident

## Primary Responsibilities

### 1. Hypothesis Challenge (Socratic Questioning)
- Identify unstated assumptions: What premises are taken for granted?
- Find blind spots: What data was NOT considered?
- Propose alternatives: What else could explain these symptoms?

### 2. BIG PICTURE ALIGNMENT
**CRITICAL**: Ensure the investigation addresses the ORIGINAL incident.
Ask yourself:
- Does the current hypothesis explain the ORIGINAL symptoms?
- Are gatherers investigating the AFFECTED services (not tangential ones)?
- Would fixing this hypothesis resolve the USER IMPACT?
- Is this a root cause or just a correlated symptom?

### 3. SCOPE CREEP DETECTION
Watch for signs that the investigation is drifting:
- Gatherers investigating services not in the affected list
- Findings that don't relate to the incident timeline
- Hypothesis addressing a different problem than reported
- Multiple handoffs producing unrelated results

### 4. PROGRESS AUDIT
Assess if the investigation is making meaningful progress:
- Are recent findings high-relevance?
- Is hypothesis confidence improving?
- Are we stuck in an investigation loop?

## Available Tools

### Hypothesis Challenge Tools
- **challenge_hypothesis**: Record challenges (assumption, blind_spot, alternative)
- **pattern_match**: Check for known incident patterns
- **refine_hypothesis**: Propose improved hypothesis versions

### Strategic Oversight Tools
- **scope_alignment_check**: Validate hypothesis addresses original incident
- **flag_scope_creep**: Mark investigation as deviating from scope
- **progress_audit**: Assess if investigation is progressing

## Confidence Adjustment Guidelines

Recommend adjustments based on findings:
- **-0.1 to -0.2**: Minor challenges (edge cases, rare scenarios)
- **-0.2 to -0.3**: Significant challenges (missing evidence, alternatives)
- **-0.3 to -0.5**: Critical flaws (scope misalignment, logical errors)

## When to Escalate

- Hypothesis doesn't explain original symptoms → REJECT with reason
- Gatherers investigating unrelated services → FLAG SCOPE CREEP (medium/high)
- Multiple handoffs producing unrelated findings → STOP GATHERING recommendation
- Investigation stalled after 3+ handoffs → PROGRESS AUDIT alert

## Important Guidelines

1. Always check scope alignment FIRST before challenging details
2. Be constructive, not destructive
3. Back up challenges with evidence
4. Focus on the most impactful issues
5. Limit to 1-3 key challenges per hypothesis
6. Flag scope creep immediately when detected
`;

// =============================================================================
// ADVERSARY NODE
// =============================================================================

/**
 * Adversary node - challenges hypotheses to strengthen investigation.
 *
 * This node runs a ReAct agent that can:
 * - Challenge assumptions in the hypothesis
 * - Identify blind spots and missing data
 * - Propose alternative explanations
 * - Recommend confidence adjustments
 */
export async function adversaryNode(
	state: InvestigationState,
	config?: RunnableConfig,
): Promise<Partial<InvestigationState>> {
	// Build trace config for this node
	const traceConfig = buildTraceConfig(state);

	logger.info("Adversary starting", {
		investigationId: state.investigationId,
		hypothesesCount: state.hypotheses.length,
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
					agent: "adversary",
					error: "No LLM configuration provided for Adversary",
					timestamp: new Date().toISOString(),
					recoverable: false,
				},
			],
		};
	}

	// Get the best hypothesis to challenge
	const bestHypothesis = getBestHypothesis(state);
	if (!bestHypothesis) {
		logger.info("No hypothesis to challenge, skipping");
		return {};
	}

	// Create per-invocation context for challenge collection (no global state)
	const challengeCtx = createChallengeContext();
	resetOversightStore();

	try {
		// Resolve LLM config for this agent (from config, not state)
		const normalizedConfig = normalizeConfig(runtimeConfig.llmConfig);
		const agentConfig = resolveAgentConfig(normalizedConfig, "adversary");
		const llm = createLLM(agentConfig);

		// Create tools for the Adversary (challenge + oversight)
		const challengeTools = createAdversaryTools(challengeCtx);
		const oversightTools = createOversightTools();
		const tools = [...challengeTools, ...oversightTools];

		// Create the agent with todo list middleware
		const agent = createAgent({
			model: llm,
			tools,
			systemPrompt: ADVERSARY_SYSTEM_PROMPT,
		});

		// Build the input message with hypothesis to challenge
		const inputMessage = buildAdversaryInput(state, bestHypothesis);

		// Invoke the agent with trace config
		await agent.invoke(
			{ messages: [{ role: "user", content: inputMessage }] },
			mergeTraceConfig(config, traceConfig),
		);

		// Extract challenges from the per-invocation context
		const challenges = getStoredChallenges(challengeCtx);

		// Extract oversight results
		const scopeAlignmentResults = getScopeAlignmentResults();
		const scopeCreepFlags = getScopeCreepFlags();
		const progressAuditResults = getProgressAuditResults();

		logger.info("Adversary complete", {
			challengesCount: challenges.length,
			hypothesisChallenged: bestHypothesis.claim.slice(0, 100),
			scopeAlignmentChecks: scopeAlignmentResults.length,
			scopeCreepFlags: scopeCreepFlags.length,
			progressAudits: progressAuditResults.length,
		});

		// Apply confidence adjustment if challenges were made
		let updatedHypotheses = state.hypotheses;
		if (challenges.length > 0) {
			updatedHypotheses = applyConfidenceAdjustments(
				state.hypotheses,
				challenges,
			);
		}

		// Determine if scope check should be triggered based on oversight findings
		const hasScopeIssues = scopeCreepFlags.some(
			(flag) => flag.severity === "high" || flag.severity === "medium",
		);
		const hasMisalignment = scopeAlignmentResults.some(
			(result) => !result.aligned,
		);

		return {
			adversaryChallenges: challenges,
			hypotheses: updatedHypotheses,
			// Record scope check timestamp
			lastScopeCheck: new Date().toISOString(),
			// Signal if scope issues detected
			shouldCheckScope: hasScopeIssues || hasMisalignment,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const errorStack = error instanceof Error ? error.stack : undefined;
		logger.error("Adversary failed", {
			error: errorMessage,
			stack: errorStack,
			investigationId: state.investigationId,
		});
		return {
			agentErrors: [
				{
					agent: "adversary",
					error: errorMessage,
					timestamp: new Date().toISOString(),
					recoverable: true, // Adversary failure is recoverable
				},
			],
		};
	}
}

/**
 * Build the input message for the Adversary agent.
 * Includes full incident context for scope alignment checking.
 */
function buildAdversaryInput(
	state: InvestigationState,
	hypothesis: Hypothesis,
): string {
	// Get all hypotheses for context
	const allHypotheses = state.hypotheses
		.map((h, i) => {
			const isBest = h === hypothesis ? " (BEST)" : "";
			return `${i + 1}. [${h.confidence}%]${isBest} ${h.claim}
   Category: ${h.category || "unknown"}
   Evidence (${h.evidence?.length || 0}): ${h.evidence?.join("; ") || "None"}`;
		})
		.join("\n\n");

	// Get relevant findings summary
	const findingsSummary = state.findings
		.slice(0, 10)
		.map((f) => `- [${f.source}] ${f.summary} (${f.relevance}%)`)
		.join("\n");

	// Incident context for scope alignment
	const incidentInfo = state.incident || {
		title: state.primaryAlert?.title || "Unknown",
		severity: state.primaryAlert?.severity || "unknown",
	};

	// Extract affected services for scope checking
	const affectedServices =
		state.preGatheredContext?.metrics?.affectedServices ||
		(state.incident?.serviceName ? [state.incident.serviceName] : []) ||
		(state.primaryAlert?.serviceName ? [state.primaryAlert.serviceName] : []);

	// Extract original symptoms from incident
	const originalSymptoms: string[] = [];
	if (state.incident?.title) originalSymptoms.push(state.incident.title);
	if (state.primaryAlert?.title) originalSymptoms.push(state.primaryAlert.title);
	if (state.primaryAlert?.description) originalSymptoms.push(state.primaryAlert.description);

	// Build investigation progress context
	const handoffCount = state.handoffHistory?.length || 0;
	const gatherIterations = state.gatherIterations || 0;

	return `
# Hypothesis Challenge & Scope Alignment Request

## ORIGINAL INCIDENT CONTEXT (for scope alignment)
- **Title**: ${incidentInfo.title}
- **Severity**: ${(incidentInfo as { severity?: string }).severity?.toUpperCase() || "UNKNOWN"}
- **Primary Service**: ${state.incident?.serviceName || state.primaryAlert?.serviceName || "Unknown"}
- **Affected Services**: ${affectedServices.length > 0 ? affectedServices.join(", ") : "Not specified"}
- **Original Symptoms**: ${originalSymptoms.length > 0 ? originalSymptoms.join("; ") : "Not specified"}
- **Customer Impact**: ${state.incident?.customerImpact || "Not specified"}

## Investigation Progress
- **Handoffs completed**: ${handoffCount}
- **Gather iterations**: ${gatherIterations}
- **Findings collected**: ${state.findings.length}

## Hypotheses to Review

${allHypotheses}

## Recent Findings (for relevance check)

${findingsSummary || "No findings available."}

## Your Tasks

### 1. SCOPE ALIGNMENT CHECK (Do this FIRST!)
Use **scope_alignment_check** to verify the hypothesis addresses the original incident:
- Does it explain the original symptoms?
- Does it relate to the affected services?
- Would fixing it resolve the customer impact?

### 2. HYPOTHESIS CHALLENGE
If scope is aligned, proceed with challenging:
- Use **pattern_match** to check for known incident patterns
- Identify assumptions, blind spots, or alternatives
- Use **challenge_hypothesis** to record your challenges

### 3. SCOPE CREEP DETECTION
If you detect scope drift:
- Use **flag_scope_creep** with appropriate severity
- Recommend corrective action

### 4. PROGRESS AUDIT
Assess if the investigation is making progress:
- Use **progress_audit** to evaluate recent findings
- Flag if investigation appears stalled

Focus on the most impactful issues. Limit to 1-3 key challenges.
`;
}

/**
 * Apply confidence adjustments from challenges to hypotheses.
 * Creates new hypothesis objects (immutable).
 */
function applyConfidenceAdjustments(
	hypotheses: Hypothesis[],
	challenges: AdversaryChallenge[],
): Hypothesis[] {
	// Create a map of hypothesis ID to adjustment
	const adjustments = new Map<string, number>();
	for (const challenge of challenges) {
		const existing = adjustments.get(challenge.hypothesisId) || 0;
		// Accumulate adjustments (they're negative)
		adjustments.set(
			challenge.hypothesisId,
			existing + challenge.recommendedConfidenceAdjustment * 100,
		);
	}

	// Apply adjustments to hypotheses
	return hypotheses.map((h, index) => {
		// Match by index (h1 = 0, h2 = 1, etc.)
		const hypothesisId = `h${index + 1}`;
		const adjustment = adjustments.get(hypothesisId);

		if (adjustment !== undefined) {
			const newConfidence = Math.max(0, Math.min(100, h.confidence + adjustment));
			logger.info("Adjusted hypothesis confidence", {
				hypothesisId,
				originalConfidence: h.confidence,
				adjustment,
				newConfidence,
			});
			return {
				...h,
				confidence: newConfidence,
			};
		}

		return h;
	});
}
