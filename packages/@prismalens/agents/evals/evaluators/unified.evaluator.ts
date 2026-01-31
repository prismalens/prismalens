/**
 * Unified Evaluation Interface
 *
 * Combines all evaluation methods into a single, comprehensive evaluation:
 * - Rule-based evaluators (hypothesis, recommendation, trajectory) - deterministic, free
 * - Ground truth comparison (keyword matching) - deterministic, free
 * - LLM-as-Judge (semantic evaluation) - costs tokens, optional
 * - Enhanced trajectory (argument validation) - deterministic, free
 *
 * Usage:
 * ```typescript
 * const result = await evaluateInvestigationUnified(investigationResult, scenario, {
 *   useLLMJudge: process.env.TEST_USE_LLM_JUDGE === "true",
 * });
 *
 * ls.logOutputs({
 *   overallScore: result.overallScore,
 *   hypothesisScore: result.ruleBased.hypothesisScore,
 *   llmJudgeScore: result.llmJudge?.overallScore,
 * });
 * ```
 */

import type { HypothesisInput } from "./hypothesis.evaluator.js";
import type { RecommendationInput } from "./recommendation.evaluator.js";
import type { ScenarioWithMocks, ExtendedExpectedOutput } from "../scenarios/types.js";

import {
	evaluateHypothesis,
	evaluateHypotheses,
	type HypothesisEvaluationResult,
} from "./hypothesis.evaluator.js";

import {
	evaluateRecommendation,
	evaluateRecommendations,
	type RecommendationEvaluationResult,
} from "./recommendation.evaluator.js";

import {
	evaluateTrajectory,
	evaluateTrajectoryEnhanced,
	extractToolCalls,
	type TrajectoryEvaluationResult,
	type EnhancedTrajectoryResult,
	type ToolCall,
} from "./trajectory.evaluator.js";

import {
	evaluateKeywordMatch,
	evaluateGroundTruth,
	type KeywordMatchResult,
	type GroundTruthResult,
} from "./ground-truth.evaluator.js";

import {
	evaluateHypothesisWithLLM,
	evaluateRecommendationWithLLM,
	evaluateInvestigationWithLLM,
	withLLMJudge,
	type LLMJudgeResult,
	type ScenarioContext,
} from "./llm-judge.evaluator.js";

import { isLLMJudgeEnabled } from "../fixtures/llm-config.js";

// =============================================================================
// TYPES
// =============================================================================

export interface RuleBasedResults {
	/** Hypothesis quality score (0-100) */
	hypothesisScore: number;
	/** Hypothesis evaluation details */
	hypothesisDetails?: HypothesisEvaluationResult;
	/** Recommendation quality score (0-100) */
	recommendationScore: number;
	/** Recommendation evaluation details */
	recommendationDetails?: RecommendationEvaluationResult;
	/** Trajectory score (0-100) */
	trajectoryScore: number;
	/** Trajectory evaluation details */
	trajectoryDetails?: TrajectoryEvaluationResult;
	/** Keyword match score (0-100) */
	keywordMatchScore: number;
	/** Keyword match details */
	keywordMatchDetails?: KeywordMatchResult;
}

export interface LLMJudgeResults {
	/** Hypothesis evaluation by LLM judge */
	hypothesisScore?: number;
	hypothesisDetails?: LLMJudgeResult;
	/** Recommendation evaluation by LLM judge */
	recommendationScore?: number;
	recommendationDetails?: LLMJudgeResult;
	/** Overall investigation evaluation by LLM judge */
	overallScore?: number;
	overallDetails?: LLMJudgeResult;
	/** LLM judge reasoning summary */
	reasoning?: string;
}

export interface EnhancedTrajectoryResults {
	/** Base trajectory score (0-100) */
	baseScore: number;
	/** Search relevance score (0-100) */
	searchRelevance: number;
	/** File relevance score (0-100) */
	fileRelevance: number;
	/** Evidence capture score (0-100) */
	evidenceCapture: number;
	/** Enhanced combined score (0-100) */
	enhancedScore: number;
	/** Full details */
	details?: EnhancedTrajectoryResult;
}

export interface UnifiedEvaluationResult {
	/** Rule-based evaluation results (deterministic, free) */
	ruleBased: RuleBasedResults;

	/** LLM-as-Judge results (semantic, costs tokens, optional) */
	llmJudge?: LLMJudgeResults;

	/** Enhanced trajectory with argument validation */
	trajectory: EnhancedTrajectoryResults;

	/** Ground truth comparison */
	groundTruth?: GroundTruthResult;

	/** Overall aggregated score (0-100) */
	overallScore: number;

	/** Feedback summary */
	feedback: string[];

	/** Whether LLM judge was used */
	usedLLMJudge: boolean;
}

export interface UnifiedEvaluationOptions {
	/** Force enable/disable LLM judge (overrides env var) */
	useLLMJudge?: boolean;
	/** Enable verbose logging */
	verbose?: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert ScenarioWithMocks to ScenarioContext for LLM judge.
 */
function toScenarioContext(scenario: ScenarioWithMocks): ScenarioContext {
	return {
		name: scenario.name,
		solutionHint: scenario.solutionHint,
		expectedCategory: scenario.expected.rootCauseCategory,
		rootCauseKeywords: scenario.expected.rootCauseKeywords,
		minConfidence: scenario.expected.minConfidence,
	};
}

/**
 * Calculate overall score from component scores.
 */
function calculateOverallScore(
	ruleBased: RuleBasedResults,
	trajectory: EnhancedTrajectoryResults,
	llmJudge?: LLMJudgeResults,
	groundTruth?: GroundTruthResult,
): number {
	const scores: Array<{ score: number; weight: number }> = [];

	// Rule-based scores (always available)
	scores.push({ score: ruleBased.hypothesisScore, weight: 25 });
	scores.push({ score: ruleBased.recommendationScore, weight: 15 });
	scores.push({ score: trajectory.enhancedScore, weight: 20 });

	// Ground truth (always available)
	if (groundTruth) {
		scores.push({ score: groundTruth.combinedScore, weight: 20 });
	} else {
		scores.push({ score: ruleBased.keywordMatchScore, weight: 20 });
	}

	// LLM judge (optional, adds weight if present)
	if (llmJudge?.overallScore !== undefined) {
		scores.push({ score: llmJudge.overallScore, weight: 20 });
	}

	const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
	const weightedSum = scores.reduce((sum, s) => sum + s.score * s.weight, 0);

	return Math.round(weightedSum / totalWeight);
}

/**
 * Generate feedback summary from all evaluations.
 */
function generateFeedback(
	ruleBased: RuleBasedResults,
	trajectory: EnhancedTrajectoryResults,
	llmJudge?: LLMJudgeResults,
	groundTruth?: GroundTruthResult,
): string[] {
	const feedback: string[] = [];

	// Rule-based feedback
	if (ruleBased.hypothesisScore < 60) {
		feedback.push(`Hypothesis quality is low (${ruleBased.hypothesisScore}/100)`);
	}
	if (ruleBased.recommendationScore < 60) {
		feedback.push(`Recommendation quality is low (${ruleBased.recommendationScore}/100)`);
	}
	if (ruleBased.keywordMatchScore < 50) {
		feedback.push(`Missing expected keywords in root cause`);
	}

	// Trajectory feedback
	if (trajectory.searchRelevance < 50) {
		feedback.push(`Agent missed searching for expected terms`);
	}
	if (trajectory.fileRelevance < 50) {
		feedback.push(`Agent missed reading expected files`);
	}

	// Ground truth feedback
	if (groundTruth?.keywordMatch.missedKeywords.length) {
		feedback.push(
			`Missed keywords: ${groundTruth.keywordMatch.missedKeywords.slice(0, 3).join(", ")}`,
		);
	}

	// LLM judge feedback
	if (llmJudge?.overallDetails?.weaknesses.length) {
		feedback.push(...llmJudge.overallDetails.weaknesses.slice(0, 2));
	}

	if (feedback.length === 0) {
		feedback.push("Investigation completed with good quality");
	}

	return feedback;
}

// =============================================================================
// MAIN EVALUATION FUNCTION
// =============================================================================

/**
 * Run unified evaluation combining all evaluation methods.
 *
 * @param result - Investigation result from the agent
 * @param scenario - Scenario with expected outputs and mocks
 * @param options - Evaluation options
 * @returns Comprehensive unified evaluation result
 *
 * @example
 * ```typescript
 * const evalResult = await evaluateInvestigationUnified(
 *   investigationResult,
 *   scenario,
 *   { useLLMJudge: true }
 * );
 *
 * // Log to LangSmith
 * ls.logOutputs({
 *   overallScore: evalResult.overallScore,
 *   hypothesisScore: evalResult.ruleBased.hypothesisScore,
 *   keywordMatch: evalResult.ruleBased.keywordMatchScore,
 *   searchRelevance: evalResult.trajectory.searchRelevance,
 *   llmJudgeScore: evalResult.llmJudge?.overallScore,
 * });
 *
 * expect(evalResult.overallScore).toBeGreaterThanOrEqual(60);
 * ```
 */
export async function evaluateInvestigationUnified(
	result: {
		status: string;
		confidence?: number | null;
		rootCauseCategory?: string | null;
		rootCause?: string | null;
		hypotheses?: HypothesisInput[];
		recommendations?: RecommendationInput[];
		agentExecutions?: unknown[];
		messages?: unknown[];
	},
	scenario: ScenarioWithMocks,
	options: UnifiedEvaluationOptions = {},
): Promise<UnifiedEvaluationResult> {
	const useLLMJudge = options.useLLMJudge ?? isLLMJudgeEnabled();

	if (options.verbose) {
		console.log("[Unified Eval] Starting evaluation", {
			scenarioName: scenario.name,
			useLLMJudge,
		});
	}

	// =========================================================================
	// 1. RULE-BASED EVALUATION (always runs)
	// =========================================================================

	// Evaluate hypothesis
	const topHypothesis = result.hypotheses?.[0];
	const hypothesisResult = topHypothesis
		? evaluateHypothesis(topHypothesis, {
				expectedCategory: scenario.expected.rootCauseCategory,
				minConfidence: scenario.expected.minConfidence,
				minEvidence: scenario.expected.minEvidence,
			})
		: { score: 0, checks: {}, feedback: ["No hypothesis provided"] };

	// Evaluate recommendations
	const topRecommendation = result.recommendations?.[0];
	const recommendationResult = topRecommendation
		? evaluateRecommendation(topRecommendation)
		: { score: 0, checks: {}, feedback: ["No recommendation provided"] };

	// Evaluate trajectory (basic)
	const toolCalls = extractToolCalls(result as Record<string, unknown>);
	const trajectoryResult = evaluateTrajectory(toolCalls, {
		requiredTools: scenario.expected.expectedToolCalls,
		forbiddenTools: scenario.expected.forbiddenToolCalls,
	});

	// Evaluate keyword match
	const combinedText = [
		result.rootCause,
		topHypothesis?.claim,
		...(topHypothesis?.evidence || []),
	]
		.filter(Boolean)
		.join(" ");
	const keywordResult = evaluateKeywordMatch(
		combinedText,
		scenario.expected.rootCauseKeywords ?? [],
	);

	const ruleBased: RuleBasedResults = {
		hypothesisScore: hypothesisResult.score,
		hypothesisDetails: hypothesisResult as HypothesisEvaluationResult,
		recommendationScore: recommendationResult.score,
		recommendationDetails: recommendationResult as RecommendationEvaluationResult,
		trajectoryScore: trajectoryResult.score,
		trajectoryDetails: trajectoryResult,
		keywordMatchScore: keywordResult.score,
		keywordMatchDetails: keywordResult,
	};

	// =========================================================================
	// 2. ENHANCED TRAJECTORY (always runs)
	// =========================================================================

	const enhancedTrajectoryResult = evaluateTrajectoryEnhanced(toolCalls, {
		requiredTools: scenario.expected.expectedToolCalls,
		forbiddenTools: scenario.expected.forbiddenToolCalls,
		expectedSearchTerms: scenario.expected.expectedSearchTerms,
		expectedFilesToRead: scenario.expected.expectedFilesToRead,
		expectedEvidencePatterns: scenario.expected.expectedEvidencePatterns,
	});

	const trajectory: EnhancedTrajectoryResults = {
		baseScore: enhancedTrajectoryResult.score,
		searchRelevance: enhancedTrajectoryResult.argumentRelevance.searchRelevance,
		fileRelevance: enhancedTrajectoryResult.argumentRelevance.fileRelevance,
		evidenceCapture: enhancedTrajectoryResult.argumentRelevance.evidenceCapture,
		enhancedScore: enhancedTrajectoryResult.enhancedScore,
		details: enhancedTrajectoryResult,
	};

	// =========================================================================
	// 3. GROUND TRUTH (keyword always, semantic if LLM judge enabled)
	// =========================================================================

	let groundTruth: GroundTruthResult | undefined;
	if (scenario.solutionHint || scenario.expected.rootCauseKeywords?.length) {
		groundTruth = await evaluateGroundTruth(combinedText, {
			rootCauseKeywords: scenario.expected.rootCauseKeywords,
			solutionHint: scenario.solutionHint,
		});
	}

	// =========================================================================
	// 4. LLM-AS-JUDGE (optional, costs tokens)
	// =========================================================================

	let llmJudge: LLMJudgeResults | undefined;
	if (useLLMJudge) {
		const scenarioContext = toScenarioContext(scenario);

		try {
			// Evaluate hypothesis with LLM
			const llmHypothesis = topHypothesis
				? await evaluateHypothesisWithLLM(topHypothesis, scenarioContext, {
						verbose: options.verbose,
					})
				: undefined;

			// Evaluate recommendation with LLM
			const llmRecommendation = topRecommendation
				? await evaluateRecommendationWithLLM(topRecommendation, scenarioContext, {
						verbose: options.verbose,
					})
				: undefined;

			// Evaluate overall investigation with LLM
			const llmOverall = await evaluateInvestigationWithLLM(result, scenarioContext, {
				verbose: options.verbose,
			});

			llmJudge = {
				hypothesisScore: llmHypothesis?.score,
				hypothesisDetails: llmHypothesis,
				recommendationScore: llmRecommendation?.score,
				recommendationDetails: llmRecommendation,
				overallScore: llmOverall.score,
				overallDetails: llmOverall,
				reasoning: llmOverall.reasoning,
			};
		} catch (error) {
			console.error("[Unified Eval] LLM judge failed:", error);
			// Continue without LLM judge results
		}
	}

	// =========================================================================
	// 5. CALCULATE OVERALL SCORE AND FEEDBACK
	// =========================================================================

	const overallScore = calculateOverallScore(ruleBased, trajectory, llmJudge, groundTruth);
	const feedback = generateFeedback(ruleBased, trajectory, llmJudge, groundTruth);

	return {
		ruleBased,
		llmJudge,
		trajectory,
		groundTruth,
		overallScore,
		feedback,
		usedLLMJudge: useLLMJudge && llmJudge !== undefined,
	};
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick evaluation with only rule-based methods (no LLM judge).
 * Use this for fast local development.
 */
export async function evaluateInvestigationQuick(
	result: Parameters<typeof evaluateInvestigationUnified>[0],
	scenario: ScenarioWithMocks,
): Promise<UnifiedEvaluationResult> {
	return evaluateInvestigationUnified(result, scenario, {
		useLLMJudge: false,
	});
}

/**
 * Full evaluation with LLM judge.
 * Use this for CI or thorough evaluation.
 */
export async function evaluateInvestigationFull(
	result: Parameters<typeof evaluateInvestigationUnified>[0],
	scenario: ScenarioWithMocks,
): Promise<UnifiedEvaluationResult> {
	return evaluateInvestigationUnified(result, scenario, {
		useLLMJudge: true,
	});
}
