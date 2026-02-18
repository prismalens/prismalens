/**
 * Investigation graph — dual purpose: LangGraph Studio + InvestigationExecutor.
 *
 * - investigationGraph(): Studio entry point (uses env vars + StubDataProvider)
 * - buildInvestigationGraph(): Shared builder (used by both Studio and Executor)
 *
 * Phase 1: Uses dummy investigator node. As agents are implemented in subsequent
 * phases, the graph progressively adds supervisor + all agent nodes.
 */

import { StateGraph } from "@langchain/langgraph"
import { MemorySaver } from "@langchain/langgraph-checkpoint"
import { InvestigationStateAnnotation } from "./state.js"
import { investigatorNode } from "./nodes.js"
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
 * Phase 1: Simple START → investigator → END (dummy node).
 * Future phases add: scout → supervisor → {gatherer, analyst, resolver}.
 */
export function buildInvestigationGraph(deps: InvestigationGraphDeps) {
  const { checkpointer } = deps

  // Phase 1: Simple dummy graph
  // Future: Replace with full multi-agent graph
  const graph = new StateGraph(InvestigationStateAnnotation)
    .addNode("investigator", investigatorNode)
    .addEdge("__start__", "investigator")
    .addEdge("investigator", "__end__")

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
