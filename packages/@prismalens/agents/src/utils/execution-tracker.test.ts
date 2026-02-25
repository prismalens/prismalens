import { describe, it, expect, beforeEach } from "vitest"
import { ExecutionTracker } from "./execution-tracker.js"

describe("ExecutionTracker", () => {
  let tracker: ExecutionTracker

  beforeEach(() => {
    tracker = new ExecutionTracker()
  })

  it("should start with empty executions", () => {
    expect(tracker.getExecutions()).toEqual([])
  })

  it("should track a task start", () => {
    tracker.onTaskStart("task-1", "scout")

    const executions = tracker.getExecutions()
    expect(executions).toHaveLength(1)
    expect(executions[0].taskId).toBe("task-1")
    expect(executions[0].agentName).toBe("scout")
    expect(executions[0].status).toBe("running")
    expect(executions[0].startedAt).toBeDefined()
    expect(executions[0].completedAt).toBeUndefined()
  })

  it("should track task completion", () => {
    tracker.onTaskStart("task-1", "analyst")
    tracker.onTaskComplete("task-1")

    const executions = tracker.getExecutions()
    expect(executions).toHaveLength(1)
    expect(executions[0].status).toBe("completed")
    expect(executions[0].completedAt).toBeDefined()
    expect(executions[0].executionTimeMs).toBeGreaterThanOrEqual(0)
  })

  it("should track task failure", () => {
    tracker.onTaskStart("task-1", "gatherer")
    tracker.onTaskComplete("task-1", "timeout error")

    const executions = tracker.getExecutions()
    expect(executions).toHaveLength(1)
    expect(executions[0].status).toBe("failed")
    expect(executions[0].error).toBe("timeout error")
  })

  it("should ignore onTaskComplete for unknown task", () => {
    tracker.onTaskComplete("unknown-task")
    expect(tracker.getExecutions()).toEqual([])
  })

  it("should track multiple tasks", () => {
    tracker.onTaskStart("task-1", "scout")
    tracker.onTaskStart("task-2", "analyst")
    tracker.onTaskComplete("task-1")
    tracker.onTaskComplete("task-2")

    const executions = tracker.getExecutions()
    expect(executions).toHaveLength(2)
    expect(executions[0].agentName).toBe("scout")
    expect(executions[0].status).toBe("completed")
    expect(executions[1].agentName).toBe("analyst")
    expect(executions[1].status).toBe("completed")
  })

  it("should compute executionTimeMs correctly", async () => {
    tracker.onTaskStart("task-1", "scout")
    // Small delay to ensure measurable time difference
    await new Promise((resolve) => setTimeout(resolve, 10))
    tracker.onTaskComplete("task-1")

    const executions = tracker.getExecutions()
    expect(executions[0].executionTimeMs).toBeGreaterThanOrEqual(5)
  })
})
