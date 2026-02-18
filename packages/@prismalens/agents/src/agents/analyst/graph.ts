/**
 * Analyst subgraph — hypothesis-driven investigation.
 *
 * Graph: START → form_hypotheses → [Send per hypothesis] → evaluate_evidence
 *        → aggregate_results → challenge → confidence_check → END
 *
 * Stub implementation — Phase 6 adds Send() parallel evaluation and tool nodes.
 */

import { StateGraph } from "@langchain/langgraph"
import { AnalystStateAnnotation } from "./state.js"
import { formHypotheses } from "./nodes/form-hypotheses.js"
import { evaluateEvidence } from "./nodes/evaluate-evidence.js"
import { aggregateResults } from "./nodes/aggregate-results.js"
import { challenge } from "./nodes/challenge.js"
import { confidenceCheck } from "./nodes/confidence-check.js"

/**
 * Build the analyst subgraph.
 *
 * Stub: linear flow without Send() parallelism.
 * Phase 6 adds Send() for parallel hypothesis evaluation.
 */
export function buildAnalystGraph() {
  return new StateGraph(AnalystStateAnnotation)
    .addNode("form_hypotheses", formHypotheses)
    .addNode("evaluate_evidence", evaluateEvidence)
    .addNode("aggregate_results", aggregateResults)
    .addNode("challenge", challenge)
    .addNode("confidence_check", confidenceCheck)
    .addEdge("__start__", "form_hypotheses")
    .addEdge("form_hypotheses", "evaluate_evidence")
    .addEdge("evaluate_evidence", "aggregate_results")
    .addEdge("aggregate_results", "challenge")
    .addEdge("challenge", "confidence_check")
    .addEdge("confidence_check", "__end__")
}
