/**
 * Shared Zod schemas for structured LLM output.
 *
 * Every LLM call in the graph uses withStructuredOutput(schema)
 * to force typed, parseable responses.
 */

import { z } from "zod"
import { ROUTABLE_AGENT_IDS } from "@prismalens/config/agents"

// =============================================================================
// Supervisor Schemas
// =============================================================================

/**
 * Supervisor routing decision — which agent to invoke next.
 */
export const SupervisorDecisionSchema = z.object({
  agent: z
    .enum([...ROUTABLE_AGENT_IDS, "__end__"])
    .describe("Next agent to route to"),
  reasoning: z
    .string()
    .describe("Brief explanation for routing decision"),
})

export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>

// =============================================================================
// Analyst Schemas
// =============================================================================

/**
 * Hypothesis formation — analyst forms root cause hypotheses.
 */
export const HypothesisFormationSchema = z.object({
  hypotheses: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum([
        "code_bug",
        "config_change",
        "infrastructure",
        "dependency",
        "deployment",
        "unknown",
      ]),
      initialConfidence: z.number().min(0).max(1),
      expectedEvidence: z
        .array(z.string())
        .describe("What evidence would confirm/deny this"),
    }),
  ),
})

export type HypothesisFormation = z.infer<typeof HypothesisFormationSchema>

/**
 * Evidence evaluation — analyst evaluates evidence per hypothesis.
 */
export const EvidenceEvaluationSchema = z.object({
  hypothesisTitle: z.string(),
  supportingEvidence: z.array(
    z.object({
      description: z.string(),
      strength: z.enum(["strong", "moderate", "weak"]),
    }),
  ),
  contradictingEvidence: z.array(
    z.object({
      description: z.string(),
      strength: z.enum(["strong", "moderate", "weak"]),
    }),
  ),
  updatedConfidence: z.number().min(0).max(1),
  needsMoreData: z.boolean(),
  dataGaps: z.array(z.string()).optional(),
})

export type EvidenceEvaluation = z.infer<typeof EvidenceEvaluationSchema>

/**
 * Challenge result — analyst searches for contradictions.
 */
export const ChallengeResultSchema = z.object({
  contradictions: z.array(
    z.object({
      hypothesisTitle: z.string(),
      contradiction: z.string(),
      severity: z.enum(["critical", "moderate", "minor"]),
    }),
  ),
  confidenceAdjustments: z.array(
    z.object({
      hypothesisTitle: z.string(),
      adjustment: z.number(),
    }),
  ),
})

export type ChallengeResult = z.infer<typeof ChallengeResultSchema>

// =============================================================================
// Resolver Schemas
// =============================================================================

/**
 * Fix proposal — resolver proposes remediation steps.
 */
export const FixProposalSchema = z.object({
  recommendations: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum([
        "code_fix",
        "config_change",
        "rollback",
        "infrastructure",
        "escalation",
      ]),
      priority: z.enum(["critical", "high", "medium", "low"]),
      urgency: z.enum(["immediate", "next_hour", "next_day", "backlog"]),
      steps: z.array(z.string()),
      precedentBased: z
        .boolean()
        .describe("Grounded in past resolution or novel approach"),
    }),
  ),
})

export type FixProposal = z.infer<typeof FixProposalSchema>

/**
 * Risk assessment — resolver evaluates risk of proposed fix.
 */
export const RiskAssessmentSchema = z.object({
  assessments: z.array(
    z.object({
      recommendationTitle: z.string(),
      riskLevel: z.enum(["critical", "high", "medium", "low"]),
      blastRadius: z.string(),
      reversibility: z.enum([
        "fully_reversible",
        "partially_reversible",
        "irreversible",
      ]),
      requiresApproval: z.boolean(),
    }),
  ),
})

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>

// =============================================================================
// Gatherer Schemas
// =============================================================================

/**
 * Gatherer summary — structured output from createDeepAgent responseFormat.
 */
export const GathererSummarySchema = z.object({
  dataSummary: z
    .string()
    .describe("Brief summary of what was gathered"),
  sourcesQueried: z.array(z.string()),
  sourcesWithData: z.array(z.string()),
  dataGaps: z.array(z.string()),
  coverageAssessment: z.enum(["sufficient", "partial", "insufficient"]),
})

export type GathererSummary = z.infer<typeof GathererSummarySchema>
