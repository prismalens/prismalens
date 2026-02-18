/**
 * Resolver agent exports.
 */

export { buildResolverGraph } from "./graph.js"
export { ResolverStateAnnotation } from "./state.js"
export type { ResolverState } from "./state.js"
export { resolverPrompt, RESOLVER_PROMPT } from "./prompt.js"

// Node exports for testing
export { lookupPrecedent } from "./nodes/lookup-precedent.js"
export { planFix } from "./nodes/plan-fix.js"
export { assessRisk } from "./nodes/assess-risk.js"
export { approvalGate } from "./nodes/approval-gate.js"

import { buildResolverGraph } from "./graph.js"

/**
 * Create the compiled resolver subgraph.
 * Added to the parent graph via addNode("resolver", createResolverGraph()).
 */
export function createResolverGraph() {
  return buildResolverGraph().compile()
}
