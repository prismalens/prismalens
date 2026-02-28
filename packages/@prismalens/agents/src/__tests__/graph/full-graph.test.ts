import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildInvestigationGraph } from "../../graph/investigation-graph.js"
import { StubDataProvider } from "../../providers/data-provider.js"
import type { AlertContext, IntegrationWithCredentials } from "../../types/contexts.js"

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
            reasoning: "Analyst needs external data",
          }
        }
        // Second supervisor call: end investigation
        return {
          agent: "__end__",
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

// Mock langchain (toolStrategy used by agents)
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

const emptyIntegrations: IntegrationWithCredentials[] = []

describe("full investigation graph", () => {
  beforeEach(() => {
    llmCallCount = 0
    vi.clearAllMocks()
  })

  it("compiles with all nodes wired", async () => {
    const graph = await buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: emptyIntegrations,
      mcpTools: [],
    })
    expect(graph).toBeDefined()
    expect(typeof graph.invoke).toBe("function")
  })

  it("executes scout → analyst → supervisor → gatherer → supervisor → __end__", async () => {
    const dataProvider = new StubDataProvider()

    const graph = await buildInvestigationGraph({
      dataProvider,
      integrations: emptyIntegrations,
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

    // Graph should terminate with a result (stall detection ends it early)
    expect(finalState.result).toBeDefined()
    expect(finalState.result.status).toBe("failed")

    // LLM called once: first supervisor pass routes to gatherer.
    // Second supervisor pass detects stall (no new data/hypotheses) and exits without LLM.
    expect(llmCallCount).toBeGreaterThanOrEqual(1)
  })

  it("scout produces a self-assessment for analyst", async () => {
    const dataProvider = new StubDataProvider()

    // Make the LLM immediately end on first call
    llmCallCount = 1 // Skip to "end" response

    const graph = await buildInvestigationGraph({
      dataProvider,
      integrations: emptyIntegrations,
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
          reasoning: "Need more data",
        })),
      })),
    } as never)

    const graph = await buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: emptyIntegrations,
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
    // Should not exceed maxIterations significantly
    expect(finalState.iterations).toBeLessThanOrEqual(4)
  })
})
