/**
 * Stream-based agent execution tracking.
 *
 * Collects agent timing from LangGraph "tasks" stream events.
 * Token tracking is handled natively by LangGraph's checkpointer metadata.
 */

/**
 * A tracked agent execution with timing info.
 */
export interface TrackedExecution {
  taskId: string
  agentName: string
  startedAt: string
  completedAt?: string
  executionTimeMs?: number
  status: "running" | "completed" | "failed"
  error?: string
}

/**
 * Tracks agent execution timing from LangGraph stream events.
 *
 * Usage:
 * ```ts
 * const tracker = new ExecutionTracker()
 * for await (const [mode, data] of executor.stream(input, config)) {
 *   if (mode === "tasks" && !data.result) tracker.onTaskStart(data.id, data.name)
 *   if (mode === "tasks" && data.result)  tracker.onTaskComplete(data.id)
 * }
 * const executions = tracker.getExecutions()
 * ```
 */
export class ExecutionTracker {
  private executions = new Map<string, TrackedExecution>()

  /**
   * Record a task starting execution.
   */
  onTaskStart(taskId: string, agentName: string): void {
    this.executions.set(taskId, {
      taskId,
      agentName,
      startedAt: new Date().toISOString(),
      status: "running",
    })
  }

  /**
   * Record a task completing execution.
   */
  onTaskComplete(taskId: string, error?: string): void {
    const execution = this.executions.get(taskId)
    if (!execution) return

    const completedAt = new Date().toISOString()
    const executionTimeMs =
      new Date(completedAt).getTime() - new Date(execution.startedAt).getTime()

    this.executions.set(taskId, {
      ...execution,
      completedAt,
      executionTimeMs,
      status: error ? "failed" : "completed",
      error,
    })
  }

  /**
   * Get all tracked executions as an array.
   */
  getExecutions(): TrackedExecution[] {
    return [...this.executions.values()]
  }
}
