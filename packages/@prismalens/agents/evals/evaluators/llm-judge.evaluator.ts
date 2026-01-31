/**
 * LLM-as-Judge Evaluator
 *
 * Uses an LLM to semantically evaluate investigation outputs against expected results.
 * This provides deeper quality assessment than rule-based checks by understanding
 * the actual meaning and correctness of agent outputs.
 *
 * Configuration:
 * - TEST_JUDGE_PROVIDER: Judge LLM provider (defaults to PRISMALENS_LLM_PROVIDER)
 * - TEST_JUDGE_MODEL: Judge LLM model (defaults to gpt-4o-mini)
 * - TEST_USE_LLM_JUDGE: Enable/disable LLM judge (default: false)
 *
 * Cost: ~$0.01-0.05 per evaluation (depends on model and output size)
 */

import { z } from "zod";
import { createLLM, type LLMProviderConfig } from "../../src/llm/factory.js";
import {
	getJudgeLLMConfig,
	isLLMJudgeEnabled,
} from "../fixtures/llm-config.js";
import type { HypothesisInput } from "./hypothesis.evaluator.js";
import type { RecommendationInput } from "./recommendation.evaluator.js";

// =============================================================================
// TYPES
// =============================================================================

export interface LLMJudgeResult {
	/** Overall score (0-100) */
	score: number;
	/** Reasoning for the score */
	reasoning: string;
	/** Identified strengths */
	strengths: string[];
	/** Identified weaknesses */
	weaknesses: string[];
}

export interface LLMJudgeOptions {
	/** Override the judge LLM config */
	llmConfig?: LLMProviderConfig;
	/** Enable verbose logging */
	verbose?: boolean;
}

export interface ScenarioContext {
	/** Scenario name */
	name: string;
	/** Expected root cause hint */
	solutionHint?: string;
	/** Expected root cause category */
	expectedCategory?: string;
	/** Keywords that should appear in root cause */
	rootCauseKeywords?: string[];
	/** Minimum expected confidence */
	minConfidence?: number;
}

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

const LLMJudgeResponseSchema = z.object({
	score: z.number().min(0).max(100),
	reasoning: z.string(),
	strengths: z.array(z.string()),
	weaknesses: z.array(z.string()),
});

// =============================================================================
// PROMPTS
// =============================================================================

const HYPOTHESIS_JUDGE_PROMPT = `You are an expert evaluator assessing the quality of incident investigation hypotheses.

## Scenario Context
- **Name**: {scenario_name}
- **Expected Root Cause**: {solution_hint}
- **Expected Category**: {expected_category}
- **Expected Keywords**: {root_cause_keywords}
- **Minimum Confidence**: {min_confidence}%

## Agent's Hypothesis
- **Claim**: {hypothesis_claim}
- **Confidence**: {hypothesis_confidence}%
- **Category**: {hypothesis_category}
- **Evidence**:
{hypothesis_evidence}

## Evaluation Criteria
Score 0-100 based on:
1. **Correctness (40%)**: Does the hypothesis identify the actual root cause?
   - Exact match to expected cause = full points
   - Related/partial identification = partial points
   - Completely wrong = 0 points

2. **Evidence Quality (30%)**: Is the evidence relevant and sufficient?
   - Multiple relevant pieces of evidence = full points
   - Some relevant evidence = partial points
   - Irrelevant or no evidence = 0 points

3. **Confidence Calibration (20%)**: Is the confidence level appropriate?
   - High confidence with strong evidence = good
   - Low confidence with weak evidence = good
   - Miscalibration (high confidence, weak evidence) = bad

4. **Completeness (10%)**: Are all aspects addressed?
   - Clear claim, category, confidence, evidence = full points
   - Missing elements = deduct points

## Output Format
Respond with a JSON object:
{
  "score": <0-100>,
  "reasoning": "<2-3 sentence explanation>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"]
}`;

const RECOMMENDATION_JUDGE_PROMPT = `You are an expert evaluator assessing the quality of incident remediation recommendations.

## Scenario Context
- **Name**: {scenario_name}
- **Expected Root Cause**: {solution_hint}
- **Expected Category**: {expected_category}

## Agent's Recommendation
- **Title**: {recommendation_title}
- **Description**: {recommendation_description}
- **Category**: {recommendation_category}
- **Priority**: {recommendation_priority}
- **Risk Score**: {recommendation_risk}
- **Verification Steps**:
{verification_steps}

## Evaluation Criteria
Score 0-100 based on:
1. **Correctness (40%)**: Does the fix address the actual root cause?
   - Directly fixes the problem = full points
   - Partial fix or workaround = partial points
   - Irrelevant fix = 0 points

2. **Actionability (30%)**: Can someone execute this recommendation?
   - Clear, specific steps = full points
   - Vague but directionally correct = partial points
   - Too vague to act on = 0 points

3. **Verification (20%)**: Are verification steps appropriate?
   - Clear steps to verify fix works = full points
   - Some verification guidance = partial points
   - No verification = 0 points

4. **Risk Assessment (10%)**: Is the risk appropriately assessed?
   - Accurate risk score and approval level = full points
   - Some risk consideration = partial points
   - No risk assessment = 0 points

## Output Format
Respond with a JSON object:
{
  "score": <0-100>,
  "reasoning": "<2-3 sentence explanation>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"]
}`;

const INVESTIGATION_JUDGE_PROMPT = `You are an expert evaluator assessing the overall quality of an incident investigation.

## Scenario Context
- **Name**: {scenario_name}
- **Expected Root Cause**: {solution_hint}
- **Expected Category**: {expected_category}
- **Expected Keywords**: {root_cause_keywords}

## Investigation Result
- **Status**: {status}
- **Overall Confidence**: {confidence}%
- **Root Cause Category**: {root_cause_category}
- **Root Cause Summary**: {root_cause}

### Top Hypothesis
- **Claim**: {hypothesis_claim}
- **Confidence**: {hypothesis_confidence}%
- **Evidence Count**: {evidence_count}

### Recommendations Count: {recommendation_count}

## Evaluation Criteria
Score 0-100 based on:
1. **Root Cause Identification (50%)**: Did the investigation find the actual cause?
   - Correctly identified = full points
   - Partially correct = partial points
   - Wrong = 0 points

2. **Investigation Quality (25%)**: Was the process thorough?
   - Multiple hypotheses considered, good evidence = full points
   - Single hypothesis, some evidence = partial points
   - Shallow investigation = 0 points

3. **Actionable Output (25%)**: Does it enable remediation?
   - Clear recommendations with verification = full points
   - Some actionable guidance = partial points
   - No actionable output = 0 points

## Output Format
Respond with a JSON object:
{
  "score": <0-100>,
  "reasoning": "<2-3 sentence explanation>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"]
}`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatEvidence(evidence: string[]): string {
	if (!evidence || evidence.length === 0) {
		return "  - (none provided)";
	}
	return evidence.map((e) => `  - ${e}`).join("\n");
}

function formatVerificationSteps(steps?: string[]): string {
	if (!steps || steps.length === 0) {
		return "  - (none provided)";
	}
	return steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
}

function substitutePrompt(
	template: string,
	vars: Record<string, string | number | undefined>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		const placeholder = `{${key}}`;
		result = result.replaceAll(placeholder, String(value ?? "N/A"));
	}
	return result;
}

async function callJudgeLLM(
	prompt: string,
	options: LLMJudgeOptions = {},
): Promise<LLMJudgeResult> {
	const config = options.llmConfig ?? getJudgeLLMConfig();
	const llm = createLLM(config);

	if (options.verbose) {
		console.log("[LLM Judge] Calling with config:", {
			provider: config.provider,
			model: config.model,
		});
	}

	const response = await llm.invoke([
		{
			role: "user",
			content: prompt,
		},
	]);

	// Extract JSON from response
	const content =
		typeof response.content === "string"
			? response.content
			: JSON.stringify(response.content);

	// Try to parse JSON from the response
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("LLM judge did not return valid JSON");
	}

	const parsed = JSON.parse(jsonMatch[0]);
	const validated = LLMJudgeResponseSchema.parse(parsed);

	return validated;
}

// =============================================================================
// MAIN EVALUATOR FUNCTIONS
// =============================================================================

/**
 * Evaluate a hypothesis using LLM-as-Judge.
 *
 * @param hypothesis - The hypothesis to evaluate
 * @param scenario - Context about the expected outcome
 * @param options - Optional configuration
 * @returns LLM judge result with score and feedback
 */
export async function evaluateHypothesisWithLLM(
	hypothesis: HypothesisInput,
	scenario: ScenarioContext,
	options: LLMJudgeOptions = {},
): Promise<LLMJudgeResult> {
	const prompt = substitutePrompt(HYPOTHESIS_JUDGE_PROMPT, {
		scenario_name: scenario.name,
		solution_hint: scenario.solutionHint,
		expected_category: scenario.expectedCategory,
		root_cause_keywords: scenario.rootCauseKeywords?.join(", "),
		min_confidence: scenario.minConfidence,
		hypothesis_claim: hypothesis.claim,
		hypothesis_confidence: hypothesis.confidence,
		hypothesis_category: hypothesis.category,
		hypothesis_evidence: formatEvidence(hypothesis.evidence),
	});

	return callJudgeLLM(prompt, options);
}

/**
 * Evaluate a recommendation using LLM-as-Judge.
 *
 * @param recommendation - The recommendation to evaluate
 * @param scenario - Context about the expected outcome
 * @param options - Optional configuration
 * @returns LLM judge result with score and feedback
 */
export async function evaluateRecommendationWithLLM(
	recommendation: RecommendationInput,
	scenario: ScenarioContext,
	options: LLMJudgeOptions = {},
): Promise<LLMJudgeResult> {
	const prompt = substitutePrompt(RECOMMENDATION_JUDGE_PROMPT, {
		scenario_name: scenario.name,
		solution_hint: scenario.solutionHint,
		expected_category: scenario.expectedCategory,
		recommendation_title: recommendation.title,
		recommendation_description: recommendation.description,
		recommendation_category: recommendation.category,
		recommendation_priority: recommendation.priority,
		recommendation_risk: recommendation.riskScore,
		verification_steps: formatVerificationSteps(recommendation.verificationSteps),
	});

	return callJudgeLLM(prompt, options);
}

/**
 * Evaluate a complete investigation result using LLM-as-Judge.
 *
 * @param result - The investigation result to evaluate
 * @param scenario - Context about the expected outcome
 * @param options - Optional configuration
 * @returns LLM judge result with score and feedback
 */
export async function evaluateInvestigationWithLLM(
	result: {
		status: string;
		confidence?: number | null;
		rootCauseCategory?: string | null;
		rootCause?: string | null;
		hypotheses?: HypothesisInput[];
		recommendations?: RecommendationInput[];
	},
	scenario: ScenarioContext,
	options: LLMJudgeOptions = {},
): Promise<LLMJudgeResult> {
	const topHypothesis = result.hypotheses?.[0];

	const prompt = substitutePrompt(INVESTIGATION_JUDGE_PROMPT, {
		scenario_name: scenario.name,
		solution_hint: scenario.solutionHint,
		expected_category: scenario.expectedCategory,
		root_cause_keywords: scenario.rootCauseKeywords?.join(", "),
		status: result.status,
		confidence: result.confidence ?? 0,
		root_cause_category: result.rootCauseCategory,
		root_cause: result.rootCause,
		hypothesis_claim: topHypothesis?.claim,
		hypothesis_confidence: topHypothesis?.confidence,
		evidence_count: topHypothesis?.evidence?.length ?? 0,
		recommendation_count: result.recommendations?.length ?? 0,
	});

	return callJudgeLLM(prompt, options);
}

// =============================================================================
// CONDITIONAL EXECUTION
// =============================================================================

/**
 * Conditionally evaluate with LLM judge if enabled.
 * Returns undefined if TEST_USE_LLM_JUDGE is not set.
 *
 * @param evaluator - The evaluator function to run
 * @returns Result or undefined if disabled
 */
export async function withLLMJudge<T>(
	evaluator: () => Promise<T>,
): Promise<T | undefined> {
	if (!isLLMJudgeEnabled()) {
		return undefined;
	}
	return evaluator();
}

/**
 * Check if LLM judge is enabled.
 * Re-exported for convenience.
 */
export { isLLMJudgeEnabled };
