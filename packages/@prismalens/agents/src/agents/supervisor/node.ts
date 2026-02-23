/**
 * Supervisor node — central orchestrator with Command routing.
 *
 * Responsibilities:
 * - Safety guards (iteration budget, stall detection)
 * - LLM routing decision with structured output
 * - Progress tracking via ProgressSnapshot
 * - Agent self-assessment reading for informed routing
 *
 * Phase 5A: Full LLM routing. No deterministic ordering guards —
 * the LLM sees agent self-assessments and makes the routing decision.
 */

import { Command } from "@langchain/langgraph"
import type { LangGraphRunnableConfig } from "@langchain/langgraph"
import type { InvestigationState, InvestigationPhase } from "../../types/state.js"
import type { SimilarIncidentMatch } from "../../types/contexts.js"
import type { InvestigationResult } from "../../types/results.js"
import type { ProgressSnapshot } from "../../types/state.js"
import { mapHypothesisCategoryToDb } from "../../utils/enum-maps.js"
import { createLLM } from "../../llm/factory.js"
import { SupervisorDecisionSchema } from "../../tools/schemas.js"
import type { SupervisorDecision } from "../../tools/schemas.js"
import { supervisorPrompt } from "./prompt.js"
import { formatStateForSupervisor } from "./format.js"

/**
 * Compile a partial result from current state.
 * Produces maximally useful output even when investigation is incomplete.
 */
export function compilePartialResult(
  state: InvestigationState,
): InvestigationResult {
  const bestHypothesis = state.hypotheses.length > 0
    ? state.hypotheses.reduce((best, h) =>
        h.confidence > best.confidence ? h : best,
      )
    : null

  return {
    investigationId: state.investigationId,
    status: "completed",
    summary: bestHypothesis
      ? `Partial analysis: ${bestHypothesis.description}`
      : "Investigation completed with partial data",
    rootCause: bestHypothesis?.description ?? null,
    rootCauseCategory: bestHypothesis?.category
      ? mapHypothesisCategoryToDb(bestHypothesis.category)
      : null,
    confidence: bestHypothesis?.confidence ?? null,
    hypotheses: state.hypotheses,
    recommendations: state.recommendations,
    error: state.errors.length > 0 ? state.errors.join("; ") : null,
    executionTimeMs: 0,
    analysisMethod: "multi-agent",
  }
}

/**
 * Take a progress snapshot for stall detection.
 */
export function takeProgressSnapshot(
  state: InvestigationState,
): ProgressSnapshot {
  const coverage = state.gatheredData?.coverage
  return {
    dataGaps: coverage?.dataGaps ?? [...(state.dataGaps ?? [])],
    sourcesQueried: [
      "incident",
      "alerts",
      ...(coverage?.changeEvents != null ? ["changeEvents"] : []),
      ...(coverage?.similarIncidents != null ? ["similarIncidents"] : []),
    ],
    hypothesisCount: state.hypotheses.length,
    bestConfidence:
      state.hypotheses.length > 0
        ? Math.max(...state.hypotheses.map((h) => h.confidence))
        : null,
    recommendationCount: state.recommendations.length,
  }
}

/**
 * Detect whether the investigation has made forward progress.
 */
export function detectProgress(
  state: InvestigationState,
): { stalled: boolean; reason?: string } {
  if (!state.lastProgressSnapshot) return { stalled: false }

  const prev = state.lastProgressSnapshot
  const curr = takeProgressSnapshot(state)

  // Order-insensitive set equality — dataGaps ordering isn't guaranteed across iterations
  const setsEqual = (a: string[], b: string[]) =>
    a.length === b.length && new Set(a).size === new Set([...a, ...b]).size

  if (
    setsEqual(prev.dataGaps, curr.dataGaps) &&
    curr.dataGaps.length > 0 &&
    setsEqual(prev.sourcesQueried, curr.sourcesQueried)
  ) {
    return { stalled: true, reason: "data gaps unchanged after gatherer run" }
  }

  if (
    prev.hypothesisCount === curr.hypothesisCount &&
    prev.bestConfidence === curr.bestConfidence &&
    prev.recommendationCount === curr.recommendationCount &&
    setsEqual(prev.sourcesQueried, curr.sourcesQueried)
  ) {
    return {
      stalled: true,
      reason: "no measurable progress in last iteration",
    }
  }

  return { stalled: false }
}

/**
 * Check if state has a high-confidence similar incident match.
 */
export function hasHighConfidenceSimilarIncident(
  state: InvestigationState,
): boolean {
  const similar = state.gatheredData?.similarIncidents as
    | SimilarIncidentMatch[]
    | undefined
  if (!similar || similar.length === 0) return false
  return similar.some((s) => s.similarity > 0.8)
}

/** Phase mapping from routing target to investigation phase */
const PHASE_MAP: Record<string, InvestigationPhase> = {
  gatherer: "gathering",
  analyst: "analysis",
  resolver: "resolution",
  __end__: "completed",
}

/**
 * Supervisor node — returns Command({ goto, update }).
 *
 * Uses LLM with structured output to decide which agent to route to next.
 * Safety guards (budget, stall) are termination conditions only.
 */
export async function supervisorNode(
  state: InvestigationState,
  config: LangGraphRunnableConfig,
): Promise<Command> {
  const maxIterations = state.config.maxIterations ?? 8

  // --- Safety Guard 1: Iteration budget ---
  if (state.iterations >= maxIterations) {
    return new Command({
      update: {
        result: compilePartialResult(state),
        phase: "completed" as const,
      },
      goto: "__end__",
    })
  }

  // --- Safety Guard 2: Stall detection ---
  const { stalled, reason } = detectProgress(state)
  if (stalled) {
    config.writer?.({ type: "stalled", reason })
    return new Command({
      update: {
        result: compilePartialResult(state),
        phase: "completed" as const,
      },
      goto: "__end__",
    })
  }

  // --- LLM Routing Decision ---
  let decision: SupervisorDecision
  try {
    const llm = createLLM(state.config.llm)
    const structuredLlm = llm.withStructuredOutput(SupervisorDecisionSchema)

    const stateContext = formatStateForSupervisor(state)
    const prompt = supervisorPrompt({
      incidentTitle: state.incident?.title ?? "Unknown",
      severity: state.incident?.severity ?? "medium",
      phase: state.phase,
    })

    decision = (await structuredLlm.invoke([
      { role: "system", content: prompt },
      { role: "user", content: stateContext },
    ])) as SupervisorDecision
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Command({
      update: {
        result: compilePartialResult(state),
        phase: "completed" as const,
        errors: [`supervisor LLM failed: ${message}`],
      },
      goto: "__end__",
    })
  }

  // --- Determine phase from routing target ---
  const nextPhase = PHASE_MAP[decision.agent] ?? state.phase

  // --- Emit progress event ---
  config.writer?.({
    type: "phase_change",
    from: state.phase,
    to: nextPhase,
  })

  // --- Build state update ---
  const update: Record<string, unknown> = {
    phase: nextPhase,
    iterations: state.iterations + 1,
    lastProgressSnapshot: takeProgressSnapshot(state),
  }

  if (decision.agent === "__end__") {
    update.result = compilePartialResult(state)
  }

  return new Command({
    update,
    goto: decision.agent,
  })
}
