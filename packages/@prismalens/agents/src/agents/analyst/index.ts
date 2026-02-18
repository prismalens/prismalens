/**
 * Analyst agent exports.
 */

export { buildAnalystGraph } from "./graph.js"
export { AnalystStateAnnotation } from "./state.js"
export type { AnalystState } from "./state.js"
export { analystPrompt, ANALYST_PROMPT } from "./prompt.js"

// Node exports for testing
export { formHypotheses } from "./nodes/form-hypotheses.js"
export { evaluateEvidence } from "./nodes/evaluate-evidence.js"
export { aggregateResults } from "./nodes/aggregate-results.js"
export { challenge } from "./nodes/challenge.js"
export { confidenceCheck } from "./nodes/confidence-check.js"

import { buildAnalystGraph } from "./graph.js"

/**
 * Create the compiled analyst subgraph.
 * Added to the parent graph via addNode("analyst", createAnalystGraph()).
 */
export function createAnalystGraph() {
  return buildAnalystGraph().compile()
}
