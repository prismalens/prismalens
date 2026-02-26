/**
 * Analyst result extraction — deterministic scoring + routing.
 *
 * Takes the structured AnalystOutput from the deep agent and:
 * 1. Applies a deterministic scoring formula (weighted by verified flag)
 * 2. Maps hypotheses to InvestigationState types
 * 3. Produces an AgentSelfAssessment with routing recommendation
 *
 * Scoring formula:
 *   Supporting:  verified strong=5, moderate=3, weak=2 | inferred strong=2, moderate=1, weak=0.5
 *   Contradicting: verified strong=-4, moderate=-2.5, weak=-1.5 | inferred strong=-1, moderate=-0.5, weak=-0.25
 *   adjustedConfidence = clamp(baseConfidence + normalizedScore, 0, 1)
 *
 * Routing:
 *   HIGH (>0.7): recommend "resolver"
 *   MEDIUM (0.4-0.7): recommend "resolver" (best-effort with available data)
 *   LOW (<0.4) + data gaps: recommend "gatherer" (needs more data)
 *   LOW (<0.4) + no gaps: recommend "resolver" (best-effort)
 *   No hypotheses: recommend "gatherer"
 */

import { randomUUID } from "node:crypto"
import type { AnalystOutput } from "../../tools/schemas.js"
import type { InvestigationState, AgentSelfAssessment, DataRequest } from "../../types/state.js"
import type { Hypothesis, Evidence } from "../../types/results.js"

// ---------------------------------------------------------------------------
// Evidence weight tables
// ---------------------------------------------------------------------------

const SUPPORTING_WEIGHTS: Record<string, Record<string, number>> = {
  verified: { strong: 5, moderate: 3, weak: 2 },
  inferred: { strong: 2, moderate: 1, weak: 0.5 },
}

const CONTRADICTING_WEIGHTS: Record<string, Record<string, number>> = {
  verified: { strong: -4, moderate: -2.5, weak: -1.5 },
  inferred: { strong: -1, moderate: -0.5, weak: -0.25 },
}

/**
 * Max possible score for normalization.
 * Assumes 5 pieces of strong verified supporting evidence.
 */
const MAX_SCORE = 5 * SUPPORTING_WEIGHTS.verified.strong

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface EvidenceItem {
  direction: "supporting" | "contradicting"
  strength: "strong" | "moderate" | "weak"
  verified: boolean
}

/**
 * Score a single hypothesis based on its evidence.
 * Returns the adjusted confidence (clamped 0-1).
 */
export function scoreHypothesis(
  baseConfidence: number,
  evidence: EvidenceItem[],
): number {
  let score = 0

  for (const e of evidence) {
    const tier = e.verified ? "verified" : "inferred"
    const weights =
      e.direction === "supporting"
        ? SUPPORTING_WEIGHTS[tier]
        : CONTRADICTING_WEIGHTS[tier]
    score += weights[e.strength] ?? 0
  }

  const normalizedScore = evidence.length > 0 ? score / MAX_SCORE : 0
  return clamp(baseConfidence + normalizedScore, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

/**
 * Map AnalystOutput evidence direction to Evidence type.
 */
function mapEvidenceType(source: string): Evidence["type"] {
  const lower = source.toLowerCase()
  if (lower.includes("log")) return "log"
  if (lower.includes("alert")) return "alert"
  if (lower.includes("metric")) return "metric"
  if (lower.includes("incident")) return "incident"
  if (lower.includes("trace")) return "trace"
  return "other"
}

/**
 * Extract analyst results from deep agent output into state updates.
 */
export function extractAnalystResults(
  agentResult: { messages: unknown[]; structuredResponse?: unknown },
  state: InvestigationState,
): Partial<InvestigationState> {
  const output = agentResult.structuredResponse as AnalystOutput | undefined

  if (!output?.hypotheses?.length) {
    return {
      lastAgentResponse: {
        agent: "analyst",
        status: "needs_more_data",
        summary: "Analyst could not form hypotheses from available data.",
        recommendation: "gatherer",
        reasoning: "Insufficient data to form root cause hypotheses.",
      },
      needsMoreData: true,
      dataGaps: output?.dataGaps ?? state.dataGaps ?? [],
    }
  }

  // Score each hypothesis
  const scoredHypotheses: Hypothesis[] = output.hypotheses.map((h) => {
    const adjustedConfidence = scoreHypothesis(h.confidence, h.evidence)

    const evidence: Evidence[] = h.evidence.map((e) => ({
      type: mapEvidenceType(e.source),
      description: e.description,
      source: e.source,
      metadata: {
        direction: e.direction,
        strength: e.strength,
        verified: e.verified,
      },
    }))

    return {
      id: randomUUID(),
      description: h.description,
      confidence: adjustedConfidence,
      evidence,
      category: h.category,
      reasoning: h.reasoning,
    }
  })

  // Sort by confidence descending (immutable — don't mutate the local array)
  const sorted = [...scoredHypotheses].sort((a, b) => b.confidence - a.confidence)

  const bestConfidence = sorted[0]?.confidence ?? 0
  const hasDataGaps = (output.dataGaps?.length ?? 0) > 0

  // Build self-assessment with routing recommendation
  const assessment = buildAssessment(
    sorted,
    bestConfidence,
    hasDataGaps,
    output,
  )

  return {
    hypotheses: sorted,
    lastAgentResponse: assessment,
    needsMoreData: assessment.recommendation === "gatherer",
    dataGaps: output.dataGaps ?? [],
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function buildAssessment(
  hypotheses: Hypothesis[],
  bestConfidence: number,
  hasDataGaps: boolean,
  output: AnalystOutput,
): AgentSelfAssessment {
  const topHypothesis = hypotheses[0]

  // HIGH confidence (>0.7) → resolver
  if (bestConfidence > 0.7) {
    return {
      agent: "analyst",
      status: "completed",
      summary: output.analysisSummary,
      recommendation: "resolver",
      reasoning: `High confidence (${(bestConfidence * 100).toFixed(0)}%) root cause identified: ${topHypothesis?.category ?? "unknown"}. ${output.confidenceAssessment}`,
    }
  }

  // LOW confidence (<0.4) + data gaps → gatherer
  if (bestConfidence < 0.4 && hasDataGaps) {
    const dataRequests = buildDataRequests(output.dataGaps)
    return {
      agent: "analyst",
      status: "needs_more_data",
      summary: output.analysisSummary,
      recommendation: "gatherer",
      dataRequests,
      reasoning: `Low confidence (${(bestConfidence * 100).toFixed(0)}%) with ${output.dataGaps.length} data gap(s). More data needed. ${output.confidenceAssessment}`,
    }
  }

  // MEDIUM (0.4-0.7) or LOW without gaps → resolver (best-effort)
  return {
    agent: "analyst",
    status: "completed",
    summary: output.analysisSummary,
    recommendation: "resolver",
    reasoning: `${bestConfidence < 0.4 ? "Low" : "Moderate"} confidence (${(bestConfidence * 100).toFixed(0)}%), proceeding with best available analysis. ${output.confidenceAssessment}`,
  }
}

/**
 * Convert data gap strings into structured DataRequest objects.
 */
function buildDataRequests(dataGaps: string[]): DataRequest[] {
  return dataGaps.map((gap) => ({
    source: inferSource(gap),
    query: gap,
    priority: "nice_to_have" as const,
    reasoning: gap,
  }))
}

/**
 * Infer the data source category from a data gap description.
 */
function inferSource(gap: string): DataRequest["source"] {
  const lower = gap.toLowerCase()
  if (lower.includes("log")) return "logs"
  if (lower.includes("code") || lower.includes("source")) return "code"
  if (lower.includes("commit") || lower.includes("git")) return "commits"
  if (lower.includes("deploy")) return "deployments"
  if (lower.includes("metric")) return "metrics"
  if (lower.includes("runbook") || lower.includes("playbook")) return "runbooks"
  return "logs" // default fallback
}
