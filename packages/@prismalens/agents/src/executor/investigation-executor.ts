/**
 * Investigation executor — main entry point for running investigations.
 *
 * Builds the StateGraph, injects DataProvider, and provides stream + invoke APIs.
 * Phase 5B: Real LangGraph streaming with ["tasks", "updates", "custom"] modes.
 */

import type { RunnableConfig } from "@langchain/core/runnables"
import type { InvestigationInput } from "../types/inputs.js"
import type { InvestigationResult } from "../types/results.js"
import type { DataProvider } from "../providers/data-provider.js"
import { StubDataProvider } from "../providers/data-provider.js"
import type { AlertContext, IntegrationContext } from "../types/contexts.js"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import {
  buildInvestigationGraph,
  type InvestigationGraphDeps,
} from "../graph/investigation-graph.js"
import { computeAvailableDataSources } from "../tools/skills/index.js"

/** Raw LangGraph stream tuple: [mode, data] */
export type StreamTuple = [string, unknown]

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
 * Provides two APIs:
 * - execute(): Synchronous invoke (backward compat)
 * - stream(): Real LangGraph streaming with native [mode, data] tuples
 */
export class InvestigationExecutor {
  private graph: ReturnType<typeof buildInvestigationGraph>
  private integrations: IntegrationContext[]

  constructor(deps: InvestigationExecutorDeps = {}) {
    this.integrations = deps.integrations ?? []

    const graphDeps: InvestigationGraphDeps = {
      dataProvider: deps.dataProvider ?? new StubDataProvider(),
      integrations: this.integrations,
      checkpointer: deps.checkpointer,
    }

    this.graph = buildInvestigationGraph(graphDeps)
  }

  /** Default timeout: 5 minutes */
  private static readonly DEFAULT_TIMEOUT_MS = 300_000

  /**
   * Build the initial state for graph execution.
   */
  private buildInitialState(input: InvestigationInput) {
    const availableDataSources = computeAvailableDataSources(
      input.integrations ?? this.integrations,
    )

    return {
      investigationId: input.investigationId,
      incidentId: input.incidentId,
      config: input.config,
      integrations: input.integrations ?? [],
      phase: "pre_gathering" as const,
      iterations: 0,
      lastProgressSnapshot: null,
      lastAgentResponse: null,
      availableDataSources,
      incident: null,
      alerts: [] as AlertContext[],
      gatheredData: {},
      needsMoreData: false,
      dataGaps: [] as string[],
      result: undefined,
    }
  }

  /**
   * Execute an investigation synchronously via graph.invoke().
   *
   * Kept for backward compatibility. New consumers should use stream().
   */
  async execute(input: InvestigationInput): Promise<InvestigationResult> {
    const startTime = Date.now()
    const timeoutMs =
      input.config.timeout ?? InvestigationExecutor.DEFAULT_TIMEOUT_MS

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const initialState = this.buildInitialState(input)

      const finalState = await this.graph.invoke(initialState, {
        signal: controller.signal,
      })

      if (!finalState.result) {
        throw new Error("Graph completed without producing a result")
      }

      return {
        ...finalState.result,
        executionTimeMs: Date.now() - startTime,
      }
    } catch (error) {
      const err = error as Error
      const isTimeout = controller.signal.aborted

      return {
        investigationId: input.investigationId,
        status: isTimeout ? "timeout" : "failed",
        summary: null,
        rootCause: null,
        rootCauseCategory: null,
        confidence: null,
        hypotheses: [],
        recommendations: [],
        error: isTimeout
          ? `Investigation timed out after ${timeoutMs}ms`
          : err.message,
        executionTimeMs: Date.now() - startTime,
        analysisMethod: null,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Stream an investigation with native LangGraph stream modes.
   *
   * Yields raw [mode, data] tuples from LangGraph:
   * - ["tasks", { id, name, input?, result? }] — node start/finish lifecycle
   * - ["updates", { nodeName: stateUpdate }] — state changes per node
   * - ["custom", { type, ... }] — user-defined progress events from config.writer()
   *
   * On error/timeout, yields a ["custom", { type: "error", ... }] event.
   */
  async *stream(
    input: InvestigationInput,
    config?: RunnableConfig,
  ): AsyncGenerator<StreamTuple> {
    const timeoutMs =
      input.config.timeout ?? InvestigationExecutor.DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const initialState = this.buildInitialState(input)

      const streamIterable = await this.graph.stream(initialState, {
        ...config,
        signal: controller.signal,
        streamMode: ["tasks", "updates", "custom"],
      })

      for await (const chunk of streamIterable) {
        yield chunk as StreamTuple
      }
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError"
      yield [
        "custom",
        {
          type: "error",
          status: isTimeout ? "timeout" : "failed",
          message: isTimeout
            ? `Investigation timed out after ${timeoutMs}ms`
            : String(error),
        },
      ]
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Close the executor and clean up resources.
   */
  async close(): Promise<void> {
    // No resources to clean up yet
  }
}
