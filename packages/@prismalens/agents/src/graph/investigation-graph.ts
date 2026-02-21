/**
 * Investigation graph — dual purpose: LangGraph Studio + InvestigationExecutor.
 *
 * - investigationGraph(): Studio entry point (uses env vars + StubDataProvider)
 * - buildInvestigationGraph(): Shared builder (used by both Studio and Executor)
 *
 * Phase 2: START → scout → supervisor(stub → __end__)
 */

import { StateGraph } from "@langchain/langgraph"
import { MemorySaver } from "@langchain/langgraph-checkpoint"
import { InvestigationStateAnnotation } from "./state.js"
import { createScoutNode } from "../agents/scout/index.js"
import { supervisorNode } from "../agents/supervisor/node.js"
import { StubDataProvider } from "../providers/data-provider.js"
import type { DataProvider } from "../providers/data-provider.js"
import type { IntegrationContext } from "../types/contexts.js"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"

/**
 * Dependencies for building the investigation graph.
 */
export interface InvestigationGraphDeps {
  dataProvider: DataProvider
  integrations: IntegrationContext[]
  checkpointer?: BaseCheckpointSaver
}

/**
 * Build the investigation graph.
 *
 * Phase 2: START → scout → supervisor(stub → __end__)
 * The supervisor stub routes to __end__ with a compiled result via Command.
 */
export function buildInvestigationGraph(deps: InvestigationGraphDeps) {
  const { checkpointer } = deps

  const graph = new StateGraph(InvestigationStateAnnotation)
    .addNode("scout", createScoutNode(deps.dataProvider))
    .addNode("supervisor", supervisorNode)
    .addEdge("__start__", "scout")
    .addEdge("scout", "supervisor")
    // supervisor routes to __end__ via Command({ goto: "__end__" })

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
    checkpointer,
  })
}
