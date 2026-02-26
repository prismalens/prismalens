/**
 * Resolver result extraction — maps structured output to state.
 *
 * Takes the ResolverOutput from the deep agent and:
 * 1. Maps recommendations to Recommendation[] (DB-aligned types)
 * 2. Links recommendations to matching hypotheses by category
 * 3. Produces an AgentSelfAssessment with routing recommendation
 */

import { randomUUID } from "node:crypto"
import type { ResolverOutput } from "../../tools/schemas.js"
import type { InvestigationState, AgentSelfAssessment } from "../../types/state.js"
import type { Hypothesis, Recommendation } from "../../types/results.js"
import type {
  RecommendationCategory,
  RecommendationPriority,
  Urgency,
  EffortEstimate,
} from "@prismalens/contracts/schemas"

/**
 * Extract resolver results from deep agent output into state updates.
 */
export function extractResolverResults(
  agentResult: { messages: unknown[]; structuredResponse?: unknown },
  state: InvestigationState,
): Partial<InvestigationState> {
  const output = agentResult.structuredResponse as ResolverOutput | undefined

  if (!output?.recommendations?.length) {
    return {
      lastAgentResponse: {
        agent: "resolver",
        status: "insufficient_context",
        summary:
          output?.summary ??
          "Resolver could not produce recommendations from available data.",
        recommendation: "analyst",
        reasoning:
          "No actionable recommendations could be generated. Analyst should provide more context.",
      },
    }
  }

  const recommendations: Recommendation[] = output.recommendations.map(
    (r) => ({
      id: randomUUID(),
      title: r.title,
      description: r.description,
      category: r.category as RecommendationCategory,
      priority: r.priority as RecommendationPriority,
      urgency: r.urgency as Urgency,
      steps: r.steps,
      estimatedEffort: r.estimatedEffort as EffortEstimate,
      tags: [
        r.precedentBased ? "historical" : "novel",
        `risk:${r.riskLevel}`,
        `reversibility:${r.reversibility}`,
      ],
      relatedHypothesisId: findMatchingHypothesis(
        r.category,
        state.hypotheses,
      ),
    }),
  )

  const assessment = buildAssessment(recommendations, output)

  return {
    recommendations,
    lastAgentResponse: assessment,
  }
}

/**
 * Find the best-matching hypothesis for a recommendation by category.
 *
 * Maps resolver categories to analyst categories:
 * - code_fix → code_bug
 * - config_change → config_change
 * - rollback → deployment
 * - monitoring → infrastructure (monitoring gaps suggest infra issues)
 * - investigation → unknown (needs further investigation)
 */
function findMatchingHypothesis(
  category: string,
  hypotheses: Hypothesis[],
): string | undefined {
  const categoryMap: Record<string, string[]> = {
    code_fix: ["code_bug"],
    config_change: ["config_change"],
    rollback: ["deployment"],
    monitoring: ["infrastructure"],
    investigation: ["unknown", "dependency"],
  }

  const targetCategories = categoryMap[category] ?? []

  // Find highest-confidence hypothesis matching the target categories
  const match = hypotheses
    .filter((h) => h.category && targetCategories.includes(h.category))
    .sort((a, b) => b.confidence - a.confidence)[0]

  // Fall back to highest-confidence hypothesis overall
  return (
    match?.id ??
    [...hypotheses].sort((a, b) => b.confidence - a.confidence)[0]?.id
  )
}

function buildAssessment(
  recommendations: Recommendation[],
  output: ResolverOutput,
): AgentSelfAssessment {
  const highRiskCount = recommendations.filter((r) =>
    r.tags?.includes("risk:critical") || r.tags?.includes("risk:high"),
  ).length

  const historicalCount = recommendations.filter((r) =>
    r.tags?.includes("historical"),
  ).length

  const riskNote =
    highRiskCount > 0
      ? ` ${highRiskCount} high-risk recommendation(s) flagged.`
      : ""

  const provenanceNote =
    historicalCount > 0
      ? ` ${historicalCount} grounded in precedent.`
      : " All recommendations are novel approaches."

  return {
    agent: "resolver",
    status: "completed",
    summary: output.summary,
    recommendation: "__end__",
    reasoning: `Generated ${recommendations.length} recommendations.${riskNote}${provenanceNote} ${output.approachAssessment}`,
  }
}
