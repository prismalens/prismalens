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
// Analyst Deep Agent Schema
// =============================================================================

/**
 * Analyst structured output — deep agent produces hypotheses with evidence.
 *
 * The `verified` flag on evidence distinguishes tool-produced evidence
 * (verified: true) from LLM reasoning (verified: false). Currently all
 * evidence is inferred. When verification tools are added (source control,
 * sandbox), tool results will be marked verified: true and weighted more
 * heavily by the deterministic scoring formula.
 */
export const AnalystOutputSchema = z.object({
  hypotheses: z.array(
    z.object({
      description: z.string().describe("Root cause hypothesis"),
      category: z.enum([
        "code_bug",
        "config_change",
        "infrastructure",
        "dependency",
        "deployment",
        "unknown",
      ]),
      confidence: z.number().min(0).max(1).describe("LLM's initial confidence estimate"),
      evidence: z.array(
        z.object({
          description: z.string(),
          direction: z.enum(["supporting", "contradicting"]),
          strength: z.enum(["strong", "moderate", "weak"]),
          verified: z.boolean().describe("true only if produced by a tool call"),
          source: z.string().describe("Where this evidence came from"),
        }),
      ),
      contradictions: z.array(z.string()),
      reasoning: z.string(),
    }),
  ),
  dataGaps: z
    .array(z.string())
    .describe("Missing data that would improve analysis"),
  analysisSummary: z.string(),
  confidenceAssessment: z
    .string()
    .describe("Honest assessment of overall confidence level"),
})

export type AnalystOutput = z.infer<typeof AnalystOutputSchema>

// =============================================================================
// Resolver Deep Agent Schema
// =============================================================================

/**
 * Resolver structured output — combined recommendations with inline risk.
 *
 * Merges fix proposal + risk assessment into a single schema. Enum values
 * are aligned with DB contracts (RecommendationCategory, Urgency, EffortEstimate).
 *
 * Each recommendation includes:
 * - Fix proposal fields (title, description, category, priority, urgency, steps)
 * - Risk assessment fields (riskLevel, blastRadius, reversibility)
 * - Provenance flag (precedentBased) for historical vs novel tracking
 */
export const ResolverOutputSchema = z.object({
  recommendations: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum([
        "code_fix",
        "config_change",
        "rollback",
        "monitoring",
        "investigation",
      ]),
      priority: z.enum(["critical", "high", "medium", "low"]),
      urgency: z.enum(["immediate", "short_term", "long_term"]),
      steps: z.array(z.string()),
      estimatedEffort: z.enum(["minutes", "hours", "days"]),
      precedentBased: z
        .boolean()
        .describe("true if grounded in a past resolution, false if novel approach"),
      riskLevel: z.enum(["critical", "high", "medium", "low"]),
      blastRadius: z
        .string()
        .describe("What systems/users could be affected"),
      reversibility: z.enum([
        "fully_reversible",
        "partially_reversible",
        "irreversible",
      ]),
    }),
  ),
  summary: z.string().describe("Brief summary of recommended approach"),
  approachAssessment: z
    .string()
    .describe("Honest assessment of the recommended approach and its limitations"),
})

export type ResolverOutput = z.infer<typeof ResolverOutputSchema>

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
