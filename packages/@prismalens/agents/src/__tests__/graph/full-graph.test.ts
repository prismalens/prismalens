import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildInvestigationGraph } from "../../graph/investigation-graph.js"
import { StubDataProvider } from "../../providers/data-provider.js"
import type { AlertContext } from "../../types/contexts.js"

// Track LLM invocation count for counter-based mock routing
let llmCallCount = 0

vi.mock("../../llm/factory.js", () => ({
  createLLM: vi.fn(() => ({
    withStructuredOutput: vi.fn(() => ({
      invoke: vi.fn(async () => {
        llmCallCount++
        // First supervisor call: analyst requested data → route to gatherer
        if (llmCallCount === 1) {
          return {
            agent: "gatherer",
            phase: "gathering",
            reasoning: "Analyst needs external data",
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

// Mock deepagents with all required exports
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
}))

// Mock langchain (toolStrategy + createMiddleware used by tool-gating-middleware)
vi.mock("langchain", () => ({
  toolStrategy: vi.fn(() => ({})),
  createMiddleware: vi.fn((_opts: unknown) => ({
    name: "MockMiddleware",
  })),
}))

describe("full investigation graph", () => {
  beforeEach(() => {
    llmCallCount = 0
    vi.clearAllMocks()
  })

  it("compiles with all nodes wired", () => {
    const graph = buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: [],
      mcpTools: [],
    })
    expect(graph).toBeDefined()
    expect(typeof graph.invoke).toBe("function")
  })

  it("executes scout → analyst → supervisor → gatherer → supervisor → __end__", async () => {
    const dataProvider = new StubDataProvider()

    const graph = buildInvestigationGraph({
      dataProvider,
      integrations: [],
      mcpTools: [],
    })

    const initialState = {
      investigationId: "inv-test",
      incidentId: "inc-test",
      config: {
        llm: { provider: "anthropic" as const, model: "test-model" },
        maxIterations: 8,
      },
      integrations: [],
      phase: "pre_gathering" as const,
      iterations: 0,
      lastProgressSnapshot: null,
      lastAgentResponse: null,
      availableDataSources: [],
      incident: null,
      alerts: [] as AlertContext[],
      gatheredData: {},
      needsMoreData: false,
      dataGaps: [] as string[],
      result: undefined,
    }

    const finalState = await graph.invoke(initialState)

    // Graph should complete
    expect(finalState.result).toBeDefined()
    expect(finalState.result.status).toBe("completed")
    expect(finalState.phase).toBe("completed")

    // LLM called once: first supervisor pass routes to gatherer.
    // Second supervisor pass detects stall (no new data/hypotheses) and exits without LLM.
    expect(llmCallCount).toBeGreaterThanOrEqual(1)
  })

  it("scout produces a self-assessment for analyst", async () => {
    const dataProvider = new StubDataProvider()

    // Make the LLM immediately end on first call
    llmCallCount = 1 // Skip to "end" response

    const graph = buildInvestigationGraph({
      dataProvider,
      integrations: [],
      mcpTools: [],
    })

    const initialState = {
      investigationId: "inv-test",
      incidentId: "inc-test",
      config: {
        llm: { provider: "anthropic" as const, model: "test-model" },
        maxIterations: 8,
      },
      integrations: [],
      phase: "pre_gathering" as const,
      iterations: 0,
      lastProgressSnapshot: null,
      lastAgentResponse: null,
      availableDataSources: [],
      incident: null,
      alerts: [] as AlertContext[],
      gatheredData: {},
      needsMoreData: false,
      dataGaps: [] as string[],
      result: undefined,
    }

    const finalState = await graph.invoke(initialState)

    // The graph should have gone: scout → analyst → supervisor → __end__
    // The last agent response should be from analyst (the last node before supervisor)
    expect(finalState.lastAgentResponse).toBeDefined()
    expect(finalState.lastAgentResponse.agent).toBe("analyst")
  })

  it("iteration budget prevents infinite loops", async () => {
    // Override LLM to always route to gatherer (infinite loop attempt)
    const { createLLM } = await import("../../llm/factory.js")
    vi.mocked(createLLM).mockReturnValue({
      withStructuredOutput: vi.fn(() => ({
        invoke: vi.fn(async () => ({
          agent: "gatherer",
          phase: "gathering",
          reasoning: "Need more data",
        })),
      })),
    } as never)

    const graph = buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: [],
      mcpTools: [],
    })

    const initialState = {
      investigationId: "inv-budget",
      incidentId: "inc-budget",
      config: {
        llm: { provider: "anthropic" as const, model: "test-model" },
        maxIterations: 3,
      },
      integrations: [],
      phase: "pre_gathering" as const,
      iterations: 0,
      lastProgressSnapshot: null,
      lastAgentResponse: null,
      availableDataSources: [],
      incident: null,
      alerts: [] as AlertContext[],
      gatheredData: {},
      needsMoreData: false,
      dataGaps: [] as string[],
      result: undefined,
    }

    const finalState = await graph.invoke(initialState)

    // Should have been stopped by iteration budget
    expect(finalState.result).toBeDefined()
    expect(finalState.phase).toBe("completed")
    // Should not exceed maxIterations significantly
    expect(finalState.iterations).toBeLessThanOrEqual(4)
  })
})
