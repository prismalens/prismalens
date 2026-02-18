/**
 * Investigation executor — main entry point for running investigations.
 *
 * Builds the StateGraph, injects DataProvider, and provides stream-only API.
 * Phase 1: Keeps dummy graph working. Phase 5: Full multi-agent graph + streaming.
 */

import type { RunnableConfig } from "@langchain/core/runnables"
import type { InvestigationInput } from "../types/inputs.js"
import type { InvestigationResult } from "../types/results.js"
import type { InvestigationProgressEvent } from "../types/progress.js"
import type { DataProvider } from "../providers/data-provider.js"
import { StubDataProvider } from "../providers/data-provider.js"
import type { AlertContext, IntegrationContext } from "../types/contexts.js"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import {
  buildInvestigationGraph,
  type InvestigationGraphDeps,
} from "../graph/investigation-graph.js"

/**
 * Dependencies for the investigation executor.
 */
export interface InvestigationExecutorDeps {
  dataProvider?: DataProvider
  integrations?: IntegrationContext[]
  checkpointer?: BaseCheckpointSaver
}

/**
 * Investigation executor — orchestrates the investigation workflow.
 *
 * Phase 1: Uses dummy graph with single investigator node.
 * Phase 5: Full multi-agent graph with supervisor + streaming.
 */
export class InvestigationExecutor {
  private graph: ReturnType<typeof buildInvestigationGraph>

  constructor(deps: InvestigationExecutorDeps = {}) {
    const graphDeps: InvestigationGraphDeps = {
      dataProvider: deps.dataProvider ?? new StubDataProvider(),
      integrations: deps.integrations ?? [],
      checkpointer: deps.checkpointer,
    }

    this.graph = buildInvestigationGraph(graphDeps)
  }

  /**
   * Execute an investigation (legacy synchronous API).
   *
   * Kept for backward compatibility with QueueService.
   * Phase 5 consumers should migrate to stream().
   */
  async execute(input: InvestigationInput): Promise<InvestigationResult> {
    const startTime = Date.now()

    try {
      const initialState = {
        investigationId: input.investigationId,
        incidentId: input.incidentId,
        config: input.config,
        integrations: input.integrations ?? [],
        phase: "pre_gathering" as const,
        iterations: 0,
        lastProgressSnapshot: null,
        incident: null,
        alerts: [] as AlertContext[],
        gatheredData: {},
        needsMoreData: false,
        dataGaps: [] as string[],
        result: undefined,
      }

      const finalState = await this.graph.invoke(initialState)

      if (!finalState.result) {
        throw new Error("Graph completed without producing a result")
      }

      const result = finalState.result
      result.executionTimeMs = Date.now() - startTime

      return result
    } catch (error) {
      const err = error as Error

      return {
        investigationId: input.investigationId,
        status: "failed",
        summary: null,
        rootCause: null,
        rootCauseCategory: null,
        confidence: null,
        hypotheses: [],
        recommendations: [],
        error: err.message,
        executionTimeMs: Date.now() - startTime,
        analysisMethod: null,
      }
    }
  }

  /**
   * Stream an investigation with progress events.
   *
   * Stub: Phase 5 implements real LangGraph streaming with ["updates", "custom"] modes.
   * For now, executes synchronously and yields a single completed event.
   */
  async *stream(
    input: InvestigationInput,
    _config?: RunnableConfig,
  ): AsyncGenerator<InvestigationProgressEvent> {
    const result = await this.execute(input)
    yield { type: "completed", result }
  }

  /**
   * Close the executor and clean up resources.
   */
  async close(): Promise<void> {
    // No resources to clean up in Phase 1
  }
}
