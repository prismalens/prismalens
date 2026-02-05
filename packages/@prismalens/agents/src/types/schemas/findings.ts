/**
 * Findings Schemas - Investigation Output Types
 *
 * Defines schemas for hypotheses, code changes, recommendations,
 * adversary challenges, and execution records.
 */

import { z } from "zod";

// =============================================================================
// HYPOTHESIS
// =============================================================================

/**
 * Hypothesis schema - Detective agent's root cause hypothesis
 */
export const HypothesisSchema = z.object({
	claim: z.string().describe("The root cause hypothesis"),
	confidence: z.number().min(0).max(100).describe("Confidence level 0-100"),
	evidence: z.array(z.string()).describe("Evidence supporting this hypothesis"),
	category: z
		.enum(["code", "config", "infrastructure", "external", "unknown"])
		.optional(),
	timestamp: z.string().optional(),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

// =============================================================================
// CODE CHANGE
// =============================================================================

/**
 * Code change schema - Surgeon's proposed code fix
 */
export const CodeChangeSchema = z.object({
	filePath: z.string().describe("Path to the file to modify"),
	searchBlock: z
		.string()
		.describe("Exact content to find (must match exactly)"),
	replaceBlock: z.string().describe("Content to replace with"),
	testCase: z.string().describe("How to verify this fix works"),
});

export type CodeChange = z.infer<typeof CodeChangeSchema>;

// =============================================================================
// RECOMMENDATION
// =============================================================================

/**
 * Recommendation schema - Actionable recommendation from investigation
 */
export const RecommendationSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	priority: z.enum(["critical", "high", "medium", "low"]),
	category: z.enum([
		"code_fix",
		"config_change",
		"rollback",
		"monitoring",
		"investigation",
	]),
	urgency: z.enum(["immediate", "short_term", "long_term"]),
	actionable: z.boolean(),
	estimatedEffort: z.enum(["minutes", "hours", "days"]).optional(),
	codeChanges: z.array(CodeChangeSchema).optional(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

// =============================================================================
// ADVERSARY CHALLENGE
// =============================================================================

/**
 * Adversary challenge record - tracks challenges made to hypotheses
 * Used by the Adversary SubAgent for Devil's Advocate reasoning
 */
export const AdversaryChallengeSchema = z.object({
	hypothesisId: z.string().describe("ID of the hypothesis being challenged"),
	originalConfidence: z.number().min(0).max(100),
	originalEvidenceCount: z.number().min(0),
	challenges: z.array(
		z.object({
			type: z.enum(["assumption", "blind_spot", "alternative"]),
			description: z.string(),
			evidence: z.string().optional(),
			source: z.string().optional(),
		}),
	),
	alternativeHypotheses: z.array(z.string()),
	recommendedConfidenceAdjustment: z.number().min(-0.5).max(0),
	refinedHypothesis: z
		.object({
			claim: z.string().optional(),
			confidence: z.number().optional(),
			evidence: z.array(z.string()).optional(),
		})
		.optional(),
	skillsUsed: z.array(z.string()),
	timestamp: z.string(),
});

export type AdversaryChallenge = z.infer<typeof AdversaryChallengeSchema>;

// =============================================================================
// TOOL EXECUTION RECORD
// =============================================================================

/**
 * Tool execution record - tracks individual tool calls
 */
export const ToolExecutionRecordSchema = z.object({
	toolName: z.string(),
	toolCategory: z.string().optional(),
	arguments: z.unknown(),
	result: z.unknown(),
	status: z.enum(["pending", "running", "success", "error"]),
	executionTimeMs: z.number().optional(),
	confidence: z.number().optional(),
	error: z.string().optional(),
	executedAt: z.string().optional(),
});

export type ToolExecutionRecord = z.infer<typeof ToolExecutionRecordSchema>;

// =============================================================================
// AGENT EXECUTION RECORD
// =============================================================================

/**
 * Agent execution record - tracks agent invocations
 */
export const AgentExecutionRecordSchema = z.object({
	agentName: z.string(),
	agentType: z.enum(["llm", "sequential", "loop"]).optional(),
	status: z.enum(["pending", "running", "completed", "failed"]),
	startedAt: z.string().optional(),
	completedAt: z.string().optional(),
	executionTimeMs: z.number().optional(),
	output: z.unknown().optional(),
	confidence: z.number().optional(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	error: z.string().optional(),
	toolExecutions: z.array(ToolExecutionRecordSchema).optional(),
});

export type AgentExecutionRecord = z.infer<typeof AgentExecutionRecordSchema>;
