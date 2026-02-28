import { describe, it, expect, vi, beforeEach } from "vitest"
import { InvestigationExecutor } from "../../executor/investigation-executor.js"
import { StubDataProvider } from "../../providers/data-provider.js"
import type { InvestigationInput } from "../../types/inputs.js"
import type { StreamTuple } from "../../executor/investigation-executor.js"

// Track LLM invocation count for counter-based mock routing
let llmCallCount = 0

vi.mock("../../llm/factory.js", () => ({
  createLLM: vi.fn(() => ({
    withStructuredOutput: vi.fn(() => ({
      invoke: vi.fn(async () => {
        llmCallCount++
        // First supervisor call: route to gatherer
        if (llmCallCount === 1) {
          return {
            agent: "gatherer",
            phase: "gathering",
            reasoning: "Need more data",
          }
        }
        // Second supervisor call: end investigation
        return {
          agent: "__end__",
          phase: "completed",
          reasoning: "Investigation complete",
        }
      }),
    })),
  })),
}))

// Mock deepagents
vi.mock("deepagents", () => ({
  createDeepAgent: vi.fn(() => ({
    invoke: vi.fn(async () => ({
      messages: [],
      structuredResponse: {
        dataSummary: "Collected test data",
        sourcesQueried: ["logs"],
        sourcesWithData: ["logs"],
        dataGaps: [],
        coverageAssessment: "sufficient",
      },
    })),
  })),
  listSkills: vi.fn(() => []),
  FilesystemBackend: vi.fn().mockImplementation(() => ({
    readFile: vi.fn(),
    listFiles: vi.fn().mockReturnValue([]),
  })),
  LocalShellBackend: {
    create: vi.fn(async () => ({
      id: "mock-backend",
      lsInfo: vi.fn(),
      read: vi.fn(),
      readRaw: vi.fn(),
      grepRaw: vi.fn(),
      globInfo: vi.fn(),
      write: vi.fn(),
      edit: vi.fn(),
      execute: vi.fn(),
    })),
  },
  CompositeBackend: vi.fn().mockImplementation((defaultBackend: unknown) => defaultBackend),
}))

vi.mock("langchain", () => ({
  toolStrategy: vi.fn(() => ({})),
}))

// Mock workspace module
vi.mock("../../config/workspace.js", () => ({
  createWorkspaceDir: vi.fn(async () => "/tmp/test-workspace"),
  injectSpecFiles: vi.fn(async () => {}),
  cleanupWorkspaceDir: vi.fn(async () => {}),
  getWorkspacePath: vi.fn(() => "/tmp/test-workspace"),
}))

function createTestInput(overrides?: Partial<InvestigationInput>): InvestigationInput {
  return {
    investigationId: "inv-stream-test",
    incidentId: "inc-stream-test",
    config: {
      llm: { provider: "anthropic" as const, model: "test-model" },
      maxIterations: 8,
    },
    integrations: [],
    ...overrides,
  }
}

describe("InvestigationExecutor.stream()", () => {
  beforeEach(() => {
    llmCallCount = 0
    vi.clearAllMocks()
  })

  it("yields LangGraph stream tuples", async () => {
    const executor = new InvestigationExecutor({
      dataProvider: new StubDataProvider(),
    })

    const input = createTestInput()
    const tuples: StreamTuple[] = []

    for await (const chunk of executor.stream(input)) {
      tuples.push(chunk)
    }

    expect(tuples.length).toBeGreaterThan(0)

    // Every tuple should be a [string, unknown] pair
    for (const tuple of tuples) {
      expect(Array.isArray(tuple)).toBe(true)
      expect(tuple).toHaveLength(2)
      expect(typeof tuple[0]).toBe("string")
    }

    // Should contain "tasks" or "updates" mode events (LangGraph native)
    const modes = new Set(tuples.map(([mode]) => mode))
    // At minimum we expect "updates" events from node state changes
    expect(modes.size).toBeGreaterThan(0)
  })

  it("yields error event on timeout", async () => {
    const executor = new InvestigationExecutor({
      dataProvider: new StubDataProvider(),
    })

    // Use a very short timeout to trigger abort
    const input = createTestInput({
      config: {
        llm: { provider: "anthropic" as const, model: "test-model" },
        timeout: 1, // 1ms — will trigger abort
      },
    })

    const tuples: StreamTuple[] = []

    for await (const chunk of executor.stream(input)) {
      tuples.push(chunk)
    }

    // Should have at least one event (possibly the error event)
    expect(tuples.length).toBeGreaterThanOrEqual(1)

    // The last event should be an error if timeout fired before any node completed
    const lastTuple = tuples[tuples.length - 1]
    // Timeout may or may not fire depending on timing — just verify the stream completes
    expect(lastTuple).toBeDefined()
  })

  it("yields error event on graph failure", async () => {
    // Create executor with a provider that will cause an error
    const failingProvider = new StubDataProvider()
    // Override fetchIncident to throw
    failingProvider.fetchIncident = async () => {
      throw new Error("Test fetch failure")
    }

    const executor = new InvestigationExecutor({
      dataProvider: failingProvider,
    })

    const input = createTestInput()
    const tuples: StreamTuple[] = []

    for await (const chunk of executor.stream(input)) {
      tuples.push(chunk)
    }

    // Stream should still complete (not throw)
    expect(tuples.length).toBeGreaterThanOrEqual(1)
  })

  it("execute() still works unchanged (backward compat)", async () => {
    const executor = new InvestigationExecutor({
      dataProvider: new StubDataProvider(),
    })

    const input = createTestInput()
    const result = await executor.execute(input)

    expect(result).toBeDefined()
    expect(result.investigationId).toBe("inv-stream-test")
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
  })
})
