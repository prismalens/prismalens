/**
 * Investigation executor — main entry point for running investigations.
 *
 * Graph-per-investigation: each investigation creates a fresh graph with
 * its own workspace directory, backend, and http_request tool bindings.
 * Workspace is cleaned up after the investigation completes.
 */

import type { RunnableConfig } from "@langchain/core/runnables"
import { getGraphConfig } from "../config/env.js"
import type { InvestigationInput } from "../types/inputs.js"
import type { InvestigationResult } from "../types/results.js"
import type { DataProvider } from "../providers/data-provider.js"
import { StubDataProvider } from "../providers/data-provider.js"
import type { AlertContext } from "../types/contexts.js"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import {
  buildInvestigationGraph,
  type InvestigationGraphDeps,
} from "../graph/investigation-graph.js"
import { computeAvailableDataSources } from "../providers/integration-registry.js"
import {
  createWorkspaceDir,
  injectSpecFiles,
  cleanupWorkspaceDir,
} from "../config/workspace.js"

/** Raw LangGraph stream tuple: [mode, data] */
export type StreamTuple = [string, unknown]

/**
 * Dependencies for the investigation executor.
 */
export interface InvestigationExecutorDeps {
  dataProvider?: DataProvider
  checkpointer?: BaseCheckpointSaver
}

/**
 * Investigation executor — orchestrates the investigation workflow.
 *
 * Graph-per-investigation architecture: each stream()/execute() call builds
 * a fresh graph with workspace and http_request tool bound to the specific
 * investigation's integrations and credentials.
 *
 * Provides two APIs:
 * - execute(): Synchronous invoke (fallback when stream yields no result)
 * - stream(): Real LangGraph streaming with native [mode, data] tuples
 */
export class InvestigationExecutor {
  private dataProvider: DataProvider
  private checkpointer?: BaseCheckpointSaver

  constructor(deps: InvestigationExecutorDeps = {}) {
    this.dataProvider = deps.dataProvider ?? new StubDataProvider()
    this.checkpointer = deps.checkpointer
  }

  /** Default timeout from env (PRISMALENS_INVESTIGATION_TIMEOUT_MS, default 5 min) */
  private get defaultTimeoutMs(): number {
    return getGraphConfig().PRISMALENS_INVESTIGATION_TIMEOUT_MS
  }

  /**
   * Build the initial state for graph execution.
   */
  private buildInitialState(input: InvestigationInput) {
    const availableDataSources = computeAvailableDataSources(
      input.integrations,
    )

    return {
      investigationId: input.investigationId,
      incidentId: input.incidentId,
      config: input.config,
      integrations: input.integrations,
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
   * Build a fresh graph for an investigation with workspace and credentials.
   */
  private async buildGraphForInvestigation(input: InvestigationInput) {
    // Create workspace and inject spec files
    const workspaceDir = await createWorkspaceDir(input.investigationId)
    await injectSpecFiles(workspaceDir, input.integrations)

    const graphDeps: InvestigationGraphDeps = {
      dataProvider: this.dataProvider,
      integrations: input.integrations,
      checkpointer: this.checkpointer,
      workspaceDir,
    }

    return buildInvestigationGraph(graphDeps)
  }

  /**
   * Execute an investigation synchronously via graph.invoke().
   *
   * Used as a fallback when stream() finishes without producing a result.
   */
  async execute(input: InvestigationInput, config?: RunnableConfig): Promise<InvestigationResult> {
    const startTime = Date.now()
    const timeoutMs =
      input.config.timeout ?? this.defaultTimeoutMs

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const graph = await this.buildGraphForInvestigation(input)
      const initialState = this.buildInitialState(input)

      const finalState = await graph.invoke(initialState, {
        ...config,
        signal: controller.signal,
        configurable: { ...config?.configurable },
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
      }
    } finally {
      clearTimeout(timer)
      await cleanupWorkspaceDir(input.investigationId)
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
      input.config.timeout ?? this.defaultTimeoutMs
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const graph = await this.buildGraphForInvestigation(input)
      const initialState = this.buildInitialState(input)

      const streamIterable = await graph.stream(initialState, {
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
      await cleanupWorkspaceDir(input.investigationId)
    }
  }

  /**
   * Close the executor and clean up resources.
   */
  async close(): Promise<void> {
    // No persistent resources to clean up
  }
}
