/**
 * LangGraph nodes for investigation.
 *
 * The dummy investigator is kept for Phase 1 backward compatibility.
 * It will be removed when the full multi-agent graph is wired (Phase 5).
 */

import type { InvestigationState } from "./state.js"
import type { InvestigationResult } from "../types/index.js"

/**
 * Dummy investigator node — returns a placeholder result.
 *
 * This is a minimal implementation that completes immediately with a dummy result.
 * It exists to keep the executor working while agents are scaffolded incrementally.
 */
export async function investigatorNode(
  state: InvestigationState,
): Promise<Partial<InvestigationState>> {
  const result: InvestigationResult = {
    investigationId: state.investigationId,
    status: "completed",
    summary: "Investigation completed (dummy implementation)",
    rootCause: null,
    rootCauseCategory: null,
    confidence: null,
    hypotheses: [],
    recommendations: [],
    error: null,
    executionTimeMs: 0,
    analysisMethod: "dummy",
  }

  return {
    phase: "completed",
    result,
  }
}
