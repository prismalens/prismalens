/**
 * Investigation graph — dual purpose: LangGraph Studio + InvestigationExecutor.
 *
 * - investigationGraph(): Studio entry point (uses env vars + StubDataProvider)
 * - buildInvestigationGraph(): Shared builder (used by both Studio and Executor)
 *
 * Phase 5A topology:
 *   START → scout → analyst (deterministic) → supervisor → {gatherer, analyst, resolver, __end__}
 *   gatherer → supervisor, analyst → supervisor, resolver → supervisor (loop edges)
 */

import { StateGraph } from "@langchain/langgraph"
import { MemorySaver } from "@langchain/langgraph-checkpoint"
import { InvestigationStateAnnotation } from "./state.js"
import { createScoutNode } from "../agents/scout/index.js"
import { createGathererNode } from "../agents/gatherer/index.js"
import { createAnalystGraph } from "../agents/analyst/index.js"
import { createResolverGraph } from "../agents/resolver/index.js"
import { supervisorNode } from "../agents/supervisor/node.js"
import { StubDataProvider } from "../providers/data-provider.js"
import type { DataProvider } from "../providers/data-provider.js"
import type { IntegrationContext } from "../types/contexts.js"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"

/**
 * Dependencies for building the investigation graph.
 */
export interface InvestigationGraphDeps {
  dataProvider: DataProvider
  integrations: IntegrationContext[]
  checkpointer?: BaseCheckpointSaver
  mcpTools?: StructuredToolInterface[]
}

/**
 * Build the investigation graph.
 *
 * Phase 5A topology:
 *   START → scout → analyst → supervisor → {gatherer, analyst, resolver, __end__}
 *   All agents loop back to supervisor after execution.
 */
export function buildInvestigationGraph(deps: InvestigationGraphDeps) {
  const { checkpointer } = deps

  const graph = new StateGraph(InvestigationStateAnnotation)
    .addNode("scout", createScoutNode(deps.dataProvider))
    .addNode("supervisor", supervisorNode, {
      ends: ["gatherer", "analyst", "resolver", "__end__"],
    })
    .addNode(
      "gatherer",
      createGathererNode(deps.integrations, deps.mcpTools ?? []),
    )
    .addNode("analyst", createAnalystGraph())
    .addNode("resolver", createResolverGraph())
    // START → scout → analyst (deterministic first pass, no supervisor)
    .addEdge("__start__", "scout")
    .addEdge("scout", "analyst")
    // All agents loop back to supervisor after execution
    .addEdge("analyst", "supervisor")
    .addEdge("gatherer", "supervisor")
    .addEdge("resolver", "supervisor")
    // supervisor routes via Command({ goto }) to gatherer/analyst/resolver/__end__

  return graph.compile({ checkpointer })
}

/**
 * LangGraph Studio entry point.
 *
 * Uses env vars for LLM config and StubDataProvider for mock data.
 * Studio calls this function to get the graph instance.
 */
export function investigationGraph() {
  const dataProvider = new StubDataProvider()
  const checkpointer = new MemorySaver()

  return buildInvestigationGraph({
    dataProvider,
    integrations: [],
    mcpTools: [],
    checkpointer,
  })
}
