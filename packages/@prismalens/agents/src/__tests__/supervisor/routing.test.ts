import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "@langchain/langgraph"
import type { LangGraphRunnableConfig } from "@langchain/langgraph"
import {
  supervisorNode,
  compilePartialResult,
  takeProgressSnapshot,
  detectProgress,
  hasHighConfidenceSimilarIncident,
} from "../../agents/supervisor/node.js"
import type { InvestigationState } from "../../types/state.js"
import type { AlertContext, IncidentContext } from "../../types/contexts.js"

// Mock createLLM to return a mock model with withStructuredOutput
vi.mock("../../llm/factory.js", () => ({
  createLLM: vi.fn(() => ({
    withStructuredOutput: vi.fn(() => ({
      invoke: vi.fn(),
    })),
  })),
}))

import { createLLM } from "../../llm/factory.js"

/** Extract goto and update from a Command instance */
function extractCommand(cmd: Command): {
  goto: string[]
  update: Record<string, unknown>
} {
  // Command stores goto as array internally, update as object
  const raw = cmd as unknown as { goto: string[]; update: Record<string, unknown> }
  return { goto: raw.goto, update: raw.update }
}

function makeIncident(
  overrides: Partial<IncidentContext> = {},
): IncidentContext {
  return {
    incidentId: "inc-1",
    number: 1,
    title: "OOM in service-a",
    severity: "high",
    status: "investigating",
    priority: "p2",
    alertCount: 3,
    triggeredAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeState(
  overrides: Partial<InvestigationState> = {},
): InvestigationState {
  return {
    investigationId: "inv-1",
    incidentId: "inc-1",
    config: {
      llm: { provider: "anthropic", model: "claude-sonnet-4-5-20250514" },
      maxIterations: 8,
    },
    integrations: [],
    phase: "gathering",
    iterations: 0,
    lastProgressSnapshot: null,
    lastAgentResponse: null,
    availableDataSources: [],
    incident: makeIncident(),
    alerts: [] as AlertContext[],
    gatheredData: {},
    needsMoreData: false,
    dataGaps: [],
    skillsLoaded: [],
    errors: [],
    hypotheses: [],
    recommendations: [],
    ...overrides,
  }
}

function makeConfig(): LangGraphRunnableConfig {
  return {
    writer: vi.fn(),
  } as unknown as LangGraphRunnableConfig
}

function mockLLMResponse(decision: {
  agent: string
  phase: string
  reasoning: string
}) {
  const mockModel = {
    withStructuredOutput: vi.fn(() => ({
      invoke: vi.fn().mockResolvedValue(decision),
    })),
  }
  vi.mocked(createLLM).mockReturnValue(mockModel as never)
  return mockModel
}

describe("supervisorNode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("routes to __end__ when iteration budget exceeded", async () => {
    const state = makeState({
      iterations: 8,
      config: { llm: { provider: "anthropic", model: "test" }, maxIterations: 8 },
    })
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    expect(result).toBeInstanceOf(Command)
    const { goto, update } = extractCommand(result)
    expect(goto).toEqual(["__end__"])
    expect(update.result).toBeDefined()
    expect(update.phase).toBe("completed")
    // LLM should NOT be called
    expect(createLLM).not.toHaveBeenCalled()
  })

  it("routes to __end__ when stalled", async () => {
    const snapshot = {
      dataGaps: ["logs"],
      sourcesQueried: ["incident", "alerts"],
      hypothesisCount: 0,
      bestConfidence: null,
      recommendationCount: 0,
    }
    const state = makeState({
      iterations: 2,
      lastProgressSnapshot: snapshot,
      gatheredData: {
        coverage: {
          incident: { found: true },
          alerts: { fetched: 1, total: 1, sampled: false },
          changeEvents: null,
          similarIncidents: null,
          services: { detected: [], count: 0 },
          dataCompleteness: "partial",
          dataGaps: ["logs"],
          temporalOverlap: false,
        },
      },
    })
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { goto, update } = extractCommand(result)
    expect(goto).toEqual(["__end__"])
    expect(update.result).toBeDefined()
    // Writer should emit stalled event
    expect(config.writer).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stalled" }),
    )
  })

  it("routes to gatherer when LLM decides", async () => {
    mockLLMResponse({
      agent: "gatherer",
      phase: "gathering",
      reasoning: "Need more data",
    })

    const state = makeState()
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { goto, update } = extractCommand(result)
    expect(goto).toEqual(["gatherer"])
    expect(update.phase).toBe("gathering")
    expect(update.iterations).toBe(1)
    expect(update.lastProgressSnapshot).toBeDefined()
  })

  it("routes to analyst when LLM decides", async () => {
    mockLLMResponse({
      agent: "analyst",
      phase: "analysis",
      reasoning: "Data collected, analyze",
    })

    const state = makeState()
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { goto, update } = extractCommand(result)
    expect(goto).toEqual(["analyst"])
    expect(update.phase).toBe("analysis")
  })

  it("routes to resolver when LLM decides", async () => {
    mockLLMResponse({
      agent: "resolver",
      phase: "resolution",
      reasoning: "High confidence hypothesis",
    })

    const state = makeState()
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { goto, update } = extractCommand(result)
    expect(goto).toEqual(["resolver"])
    expect(update.phase).toBe("resolution")
  })

  it("compiles result when routing to __end__", async () => {
    mockLLMResponse({
      agent: "__end__",
      phase: "completed",
      reasoning: "Investigation complete",
    })

    const state = makeState({
      hypotheses: [
        {
          id: "h1",
          description: "Memory leak",
          confidence: 0.9,
          evidence: [],
        },
      ],
    })
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { goto, update } = extractCommand(result)
    expect(goto).toEqual(["__end__"])
    expect(update.result).toBeDefined()
    const investigationResult = update.result as Record<string, unknown>
    expect(investigationResult.status).toBe("completed")
  })

  it("emits phase_change event", async () => {
    mockLLMResponse({
      agent: "analyst",
      phase: "analysis",
      reasoning: "Analyze data",
    })

    const state = makeState({ phase: "gathering" })
    const config = makeConfig()

    await supervisorNode(state, config)

    expect(config.writer).toHaveBeenCalledWith({
      type: "phase_change",
      from: "gathering",
      to: "analysis",
    })
  })

  it("increments iterations", async () => {
    mockLLMResponse({
      agent: "gatherer",
      phase: "gathering",
      reasoning: "More data",
    })

    const state = makeState({ iterations: 3 })
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { update } = extractCommand(result)
    expect(update.iterations).toBe(4)
  })

  it("updates lastProgressSnapshot", async () => {
    mockLLMResponse({
      agent: "analyst",
      phase: "analysis",
      reasoning: "Analyze",
    })

    const state = makeState()
    const config = makeConfig()

    const result = await supervisorNode(state, config)

    const { update } = extractCommand(result)
    expect(update.lastProgressSnapshot).toBeDefined()
  })
})

describe("compilePartialResult", () => {
  it("uses best hypothesis as root cause", () => {
    const state = makeState({
      hypotheses: [
        { id: "h1", description: "Low confidence", confidence: 0.3, evidence: [] },
        { id: "h2", description: "High confidence", confidence: 0.9, evidence: [] },
      ],
    })
    const result = compilePartialResult(state)
    expect(result.rootCause).toBe("High confidence")
    expect(result.confidence).toBe(0.9)
  })

  it("returns generic summary without hypotheses", () => {
    const state = makeState()
    const result = compilePartialResult(state)
    expect(result.summary).toContain("partial data")
    expect(result.rootCause).toBeNull()
  })

  it("includes errors in result", () => {
    const state = makeState({ errors: ["fetch failed", "timeout"] })
    const result = compilePartialResult(state)
    expect(result.error).toBe("fetch failed; timeout")
  })
})

describe("detectProgress", () => {
  it("returns not stalled when no previous snapshot", () => {
    const state = makeState({ lastProgressSnapshot: null })
    expect(detectProgress(state).stalled).toBe(false)
  })

  it("detects stall when data gaps unchanged", () => {
    const snapshot = {
      dataGaps: ["logs"],
      sourcesQueried: ["incident", "alerts"],
      hypothesisCount: 0,
      bestConfidence: null,
      recommendationCount: 0,
    }
    const state = makeState({
      lastProgressSnapshot: snapshot,
      gatheredData: {
        coverage: {
          incident: { found: true },
          alerts: { fetched: 1, total: 1, sampled: false },
          changeEvents: null,
          similarIncidents: null,
          services: { detected: [], count: 0 },
          dataCompleteness: "partial",
          dataGaps: ["logs"],
          temporalOverlap: false,
        },
      },
    })
    expect(detectProgress(state).stalled).toBe(true)
  })

  it("detects progress when hypothesis count changes", () => {
    const snapshot = {
      dataGaps: [],
      sourcesQueried: ["incident", "alerts"],
      hypothesisCount: 0,
      bestConfidence: null,
      recommendationCount: 0,
    }
    const state = makeState({
      lastProgressSnapshot: snapshot,
      hypotheses: [
        { id: "h1", description: "test", confidence: 0.5, evidence: [] },
      ],
    })
    expect(detectProgress(state).stalled).toBe(false)
  })
})

describe("hasHighConfidenceSimilarIncident", () => {
  it("returns false when no similar incidents", () => {
    const state = makeState()
    expect(hasHighConfidenceSimilarIncident(state)).toBe(false)
  })

  it("returns false when similarity below threshold", () => {
    const state = makeState({
      gatheredData: {
        similarIncidents: [
          { incidentId: "old-1", title: "Old", similarity: 0.5 },
        ],
      },
    })
    expect(hasHighConfidenceSimilarIncident(state)).toBe(false)
  })

  it("returns true when high-confidence match exists", () => {
    const state = makeState({
      gatheredData: {
        similarIncidents: [
          { incidentId: "old-1", title: "Old", similarity: 0.85 },
        ],
      },
    })
    expect(hasHighConfidenceSimilarIncident(state)).toBe(true)
  })
})
