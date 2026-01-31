/**
 * Ground Truth Evaluator
 *
 * Compares agent outputs against expected ground truth using:
 * 1. Keyword-based matching (deterministic, free)
 * 2. LLM semantic matching (costs tokens, more accurate)
 *
 * The solutionHint field in scenarios provides the expected answer.
 */

import { z } from "zod";
import { createLLM, type LLMProviderConfig } from "../../src/llm/factory.js";
import {
	getJudgeLLMConfig,
	isLLMJudgeEnabled,
} from "../fixtures/llm-config.js";
import type { HypothesisInput } from "./hypothesis.evaluator.js";

// =============================================================================
// TYPES
// =============================================================================

export interface KeywordMatchResult {
	/** Score based on keyword matches (0-100) */
	score: number;
	/** Keywords that were found */
	matchedKeywords: string[];
	/** Keywords that were expected but not found */
	missedKeywords: string[];
	/** Total keywords expected */
	totalExpected: number;
}

export interface SemanticMatchResult {
	/** Semantic similarity score (0-100) */
	score: number;
	/** Reasoning for the score */
	reasoning: string;
	/** Key insights from expected that were captured */
	keyInsightsMatched: string[];
	/** Key insights from expected that were missed */
	keyInsightsMissed: string[];
	/** False positives - things agent claimed that aren't in expected */
	falsePositives: string[];
}

export interface GroundTruthOptions {
	/** Override LLM config for semantic matching */
	llmConfig?: LLMProviderConfig;
	/** Enable verbose logging */
	verbose?: boolean;
	/** Minimum keyword match ratio to consider a pass (0-1) */
	minMatchRatio?: number;
}

// =============================================================================
// RESPONSE SCHEMA
// =============================================================================

const SemanticMatchResponseSchema = z.object({
	score: z.number().min(0).max(100),
	reasoning: z.string(),
	keyInsightsMatched: z.array(z.string()),
	keyInsightsMissed: z.array(z.string()),
	falsePositives: z.array(z.string()),
});

// =============================================================================
// KEYWORD-BASED MATCHING (FREE)
// =============================================================================

/**
 * Normalize text for comparison (lowercase, remove punctuation).
 */
function normalizeText(text: string): string {
	return text.toLowerCase().replace(/[^\w\s]/g, " ");
}

/**
 * Check if a keyword appears in the text.
 * Supports multi-word keywords and partial matches.
 */
function keywordMatchesText(keyword: string, text: string): boolean {
	const normalizedKeyword = normalizeText(keyword);
	const normalizedText = normalizeText(text);

	// Exact match
	if (normalizedText.includes(normalizedKeyword)) {
		return true;
	}

	// Split multi-word keyword and check if all words appear
	const keywordWords = normalizedKeyword.split(/\s+/).filter(Boolean);
	if (keywordWords.length > 1) {
		return keywordWords.every((word) => normalizedText.includes(word));
	}

	return false;
}

/**
 * Evaluate keyword match between agent output and expected keywords.
 *
 * This is a deterministic, free evaluation method that checks whether
 * the expected keywords appear in the agent's output.
 *
 * @param agentOutput - Text from agent (claim, description, root cause)
 * @param expectedKeywords - Keywords that should appear
 * @returns Keyword match result with score and details
 *
 * @example
 * ```typescript
 * const result = evaluateKeywordMatch(
 *   "The NullPointerException in UserService.java at line 42 is caused by missing null check",
 *   ["NullPointerException", "UserService", "null check"]
 * );
 * // result.score = 100, all keywords matched
 * ```
 */
export function evaluateKeywordMatch(
	agentOutput: string,
	expectedKeywords: string[],
): KeywordMatchResult {
	if (!expectedKeywords || expectedKeywords.length === 0) {
		return {
			score: 100,
			matchedKeywords: [],
			missedKeywords: [],
			totalExpected: 0,
		};
	}

	if (!agentOutput) {
		return {
			score: 0,
			matchedKeywords: [],
			missedKeywords: expectedKeywords,
			totalExpected: expectedKeywords.length,
		};
	}

	const matchedKeywords: string[] = [];
	const missedKeywords: string[] = [];

	for (const keyword of expectedKeywords) {
		if (keywordMatchesText(keyword, agentOutput)) {
			matchedKeywords.push(keyword);
		} else {
			missedKeywords.push(keyword);
		}
	}

	const score = Math.round(
		(matchedKeywords.length / expectedKeywords.length) * 100,
	);

	return {
		score,
		matchedKeywords,
		missedKeywords,
		totalExpected: expectedKeywords.length,
	};
}

/**
 * Evaluate keyword match for a hypothesis.
 * Combines claim, evidence, and category for matching.
 */
export function evaluateHypothesisKeywordMatch(
	hypothesis: HypothesisInput,
	expectedKeywords: string[],
): KeywordMatchResult {
	// Combine all hypothesis text for matching
	const combinedText = [
		hypothesis.claim,
		hypothesis.category,
		...(hypothesis.evidence || []),
	]
		.filter(Boolean)
		.join(" ");

	return evaluateKeywordMatch(combinedText, expectedKeywords);
}

// =============================================================================
// LLM SEMANTIC MATCHING (COSTS TOKENS)
// =============================================================================

const SEMANTIC_MATCH_PROMPT = `You are comparing an agent's investigation output to the expected ground truth.

## Expected Ground Truth
{expected_text}

## Agent's Output
{agent_output}

## Task
Evaluate how well the agent's output captures the key insights from the expected ground truth.

Consider:
1. Did the agent identify the core problem?
2. Are the key technical details correct?
3. Is there any correct information missing?
4. Did the agent include anything incorrect (false positives)?

## Output Format
Respond with a JSON object:
{
  "score": <0-100 based on semantic similarity>,
  "reasoning": "<2-3 sentence explanation>",
  "keyInsightsMatched": ["<insight 1>", "<insight 2>"],
  "keyInsightsMissed": ["<missed insight 1>", "<missed insight 2>"],
  "falsePositives": ["<incorrect claim 1>", "<incorrect claim 2>"]
}

Be strict but fair. A score of 80+ means the agent captured the essential problem correctly.`;

/**
 * Evaluate semantic similarity using an LLM.
 *
 * This method costs tokens but provides deeper understanding of whether
 * the agent's output captures the meaning of the expected answer.
 *
 * @param agentOutput - Text from agent
 * @param expectedText - Expected ground truth (solutionHint)
 * @param options - Configuration options
 * @returns Semantic match result with reasoning
 */
export async function evaluateSemanticMatch(
	agentOutput: string,
	expectedText: string,
	options: GroundTruthOptions = {},
): Promise<SemanticMatchResult> {
	const config = options.llmConfig ?? getJudgeLLMConfig();
	const llm = createLLM(config);

	if (options.verbose) {
		console.log("[Semantic Match] Comparing:", {
			agentOutputLength: agentOutput?.length ?? 0,
			expectedTextLength: expectedText?.length ?? 0,
		});
	}

	const prompt = SEMANTIC_MATCH_PROMPT.replace("{expected_text}", expectedText)
		.replace("{agent_output}", agentOutput);

	const response = await llm.invoke([
		{
			role: "user",
			content: prompt,
		},
	]);

	const content =
		typeof response.content === "string"
			? response.content
			: JSON.stringify(response.content);

	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("Semantic match LLM did not return valid JSON");
	}

	const parsed = JSON.parse(jsonMatch[0]);
	return SemanticMatchResponseSchema.parse(parsed);
}

/**
 * Evaluate hypothesis against ground truth using semantic matching.
 */
export async function evaluateHypothesisSemanticMatch(
	hypothesis: HypothesisInput,
	solutionHint: string,
	options: GroundTruthOptions = {},
): Promise<SemanticMatchResult> {
	const combinedText = [
		`Claim: ${hypothesis.claim}`,
		`Category: ${hypothesis.category}`,
		`Confidence: ${hypothesis.confidence}%`,
		`Evidence: ${(hypothesis.evidence || []).join("; ")}`,
	].join("\n");

	return evaluateSemanticMatch(combinedText, solutionHint, options);
}

// =============================================================================
// COMBINED EVALUATION
// =============================================================================

export interface GroundTruthResult {
	/** Keyword-based score (deterministic) */
	keywordScore: number;
	/** Keyword match details */
	keywordMatch: KeywordMatchResult;
	/** LLM semantic score (optional, costs tokens) */
	semanticScore?: number;
	/** Semantic match details (optional) */
	semanticMatch?: SemanticMatchResult;
	/** Combined weighted score */
	combinedScore: number;
}

/**
 * Evaluate ground truth using both keyword and semantic matching.
 *
 * @param agentOutput - Text from agent
 * @param expected - Expected output with keywords and solution hint
 * @param options - Configuration options
 * @returns Combined ground truth result
 */
export async function evaluateGroundTruth(
	agentOutput: string,
	expected: {
		rootCauseKeywords?: string[];
		solutionHint?: string;
	},
	options: GroundTruthOptions = {},
): Promise<GroundTruthResult> {
	// Always run keyword matching (free)
	const keywordMatch = evaluateKeywordMatch(
		agentOutput,
		expected.rootCauseKeywords ?? [],
	);

	// Optionally run semantic matching (costs tokens)
	let semanticMatch: SemanticMatchResult | undefined;
	if (isLLMJudgeEnabled() && expected.solutionHint) {
		semanticMatch = await evaluateSemanticMatch(
			agentOutput,
			expected.solutionHint,
			options,
		);
	}

	// Calculate combined score
	let combinedScore: number;
	if (semanticMatch) {
		// Weight: 40% keyword, 60% semantic when both available
		combinedScore = Math.round(
			keywordMatch.score * 0.4 + semanticMatch.score * 0.6,
		);
	} else {
		combinedScore = keywordMatch.score;
	}

	return {
		keywordScore: keywordMatch.score,
		keywordMatch,
		semanticScore: semanticMatch?.score,
		semanticMatch,
		combinedScore,
	};
}

/**
 * Evaluate hypothesis against ground truth.
 */
export async function evaluateHypothesisGroundTruth(
	hypothesis: HypothesisInput,
	expected: {
		rootCauseKeywords?: string[];
		solutionHint?: string;
	},
	options: GroundTruthOptions = {},
): Promise<GroundTruthResult> {
	const combinedText = [
		hypothesis.claim,
		hypothesis.category,
		...(hypothesis.evidence || []),
	]
		.filter(Boolean)
		.join(" ");

	return evaluateGroundTruth(combinedText, expected, options);
}
