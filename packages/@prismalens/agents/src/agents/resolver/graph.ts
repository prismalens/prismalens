/**
 * Resolver subgraph — evidence-based remediation.
 *
 * Graph: START → lookup_precedent → plan_fix → assess_risk → approval_gate → END
 *
 * Stub implementation — Phase 7 adds tool nodes and interrupt().
 */

import { StateGraph } from "@langchain/langgraph"
import { ResolverStateAnnotation } from "./state.js"
import { lookupPrecedent } from "./nodes/lookup-precedent.js"
import { planFix } from "./nodes/plan-fix.js"
import { assessRisk } from "./nodes/assess-risk.js"
import { approvalGate } from "./nodes/approval-gate.js"

/**
 * Build the resolver subgraph.
 *
 * Stub: linear flow without ToolNode or interrupt().
 * Phase 7 adds tool execution and human-in-the-loop approval.
 */
export function buildResolverGraph() {
  return new StateGraph(ResolverStateAnnotation)
    .addNode("lookup_precedent", lookupPrecedent)
    .addNode("plan_fix", planFix)
    .addNode("assess_risk", assessRisk)
    .addNode("approval_gate", approvalGate)
    .addEdge("__start__", "lookup_precedent")
    .addEdge("lookup_precedent", "plan_fix")
    .addEdge("plan_fix", "assess_risk")
    .addEdge("assess_risk", "approval_gate")
    .addEdge("approval_gate", "__end__")
}
