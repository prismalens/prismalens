/**
 * Node-level scenario tests.
 *
 * Tests each node (analyst, gatherer, resolver, supervisor) in isolation
 * with controlled state inputs and mocked LLM/deepagents responses.
 *
 * Validates: prompt construction, structured output extraction, state
 * updates, routing logic, and error handling per-node.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AnalystOutput, ResolverOutput, GathererSummary } from "../../tools/schemas.js"
import { ANALYST_SCENARIOS } from "./nodes/analyst.scenarios.js"
import { GATHERER_SCENARIOS } from "./nodes/gatherer.scenarios.js"
import { RESOLVER_SCENARIOS } from "./nodes/resolver.scenarios.js"
import { SUPERVISOR_SCENARIOS } from "./nodes/supervisor.scenarios.js"
import { buildTestState } from "./state-builder.js"
import type { InvestigationState } from "../../types/state.js"
import type {
  AnalystExpectation,
  GathererExpectation,
  ResolverExpectation,
  SupervisorExpectation,
} from "./nodes/types.js"

// =============================================================================
// Mock Setup (same pattern as full-graph.test.ts)
// =============================================================================

// Per-scenario mock response — set before each test
let mockStructuredResponse: unknown = {}
let shouldThrow = false

const mockLLM = () => ({
  withStructuredOutput: vi.fn(() => ({
    invoke: vi.fn(async () => {
      // Supervisor routing decisions set per test
      return mockStructuredResponse
    }),
  })),
})

vi.mock("../../llm/factory.js", () => ({
  createLLM: vi.fn(mockLLM),
  resolveAgentLLM: vi.fn(mockLLM),
}))

vi.mock("deepagents", () => ({
  createDeepAgent: vi.fn(() => ({
    invoke: vi.fn(async () => {
      if (shouldThrow) {
        throw new Error("Mock agent error")
      }
      return {
        messages: [],
        structuredResponse: mockStructuredResponse,
      }
    }),
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

vi.mock("../../config/workspace.js", () => ({
  createWorkspaceDir: vi.fn(async () => "/tmp/test-workspace"),
  injectSpecFiles: vi.fn(async () => {}),
  cleanupWorkspaceDir: vi.fn(async () => {}),
  getWorkspacePath: vi.fn(() => "/tmp/test-workspace"),
}))

// Mock backend for node deps
const mockBackend = {} as never
const mockHttpRequestTool = { name: "http_request" } as never

// =============================================================================
// Analyst Node Scenarios
// =============================================================================

describe("analyst node scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shouldThrow = false
  })

  // High-confidence NPE
  it(`${ANALYST_SCENARIOS[0].name}`, async () => {
    const scenario = ANALYST_SCENARIOS[0]
    const expectation = scenario.expectation as AnalystExpectation

    mockStructuredResponse = {
      hypotheses: [
        {
          description: "NullPointerException due to removed null check in UserService",
          category: "code_bug",
          confidence: 0.85,
          evidence: [
            {
              description: "Stack trace shows NPE at UserService.java:45",
              direction: "supporting",
              strength: "strong",
              verified: false,
              source: "render-logs",
            },
          ],
          contradictions: [],
          reasoning: "Error logs clearly show NPE pattern",
        },
        {
          description: "Possible config issue",
          category: "config_change",
          confidence: 0.3,
          evidence: [
            {
              description: "Recent deployment detected",
              direction: "supporting",
              strength: "weak",
              verified: false,
              source: "deploy-events",
            },
          ],
          contradictions: [],
          reasoning: "Deployment correlates but less likely",
        },
      ],
      dataGaps: [],
      analysisSummary: "NPE root cause identified with high confidence",
      confidenceAssessment: "High confidence — strong log evidence",
    } satisfies AnalystOutput

    const { createAnalystNode } = await import("../../agents/analyst/index.js")
    const node = createAnalystNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/analyst/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    // Assert hypotheses
    expect(output.hypotheses?.length).toBeGreaterThanOrEqual(expectation.minHypotheses)

    // Assert routing recommendation
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)

    // Assert needsMoreData
    if (expectation.needsMoreData !== undefined) {
      expect(output.needsMoreData).toBe(expectation.needsMoreData)
    }

    // Assert hypothesis keywords
    if (expectation.hypothesisKeywords.length > 0) {
      const descriptions = (output.hypotheses ?? [])
        .map((h) => h.description.toLowerCase())
        .join(" ")
      for (const kw of expectation.hypothesisKeywords) {
        expect(descriptions).toContain(kw.toLowerCase())
      }
    }

    // Assert category
    if (expectation.category) {
      expect(output.hypotheses?.[0]?.category).toBe(expectation.category)
    }
  })

  // Low-confidence with gaps
  it(`${ANALYST_SCENARIOS[1].name}`, async () => {
    const scenario = ANALYST_SCENARIOS[1]
    const expectation = scenario.expectation as AnalystExpectation

    mockStructuredResponse = {
      hypotheses: [
        {
          description: "Possible performance degradation",
          category: "unknown",
          confidence: 0.3,
          evidence: [
            {
              description: "Response time elevated",
              direction: "supporting",
              strength: "weak",
              verified: false,
              source: "alerts",
            },
          ],
          contradictions: [],
          reasoning: "Limited evidence available",
        },
      ],
      dataGaps: ["metrics", "logs"],
      analysisSummary: "Low confidence — insufficient data",
      confidenceAssessment: "Low confidence",
    } satisfies AnalystOutput

    const { createAnalystNode } = await import("../../agents/analyst/index.js")
    const node = createAnalystNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/analyst/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.hypotheses?.length).toBeGreaterThanOrEqual(expectation.minHypotheses)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
    expect(output.needsMoreData).toBe(true)
  })

  // Medium-confidence no gaps
  it(`${ANALYST_SCENARIOS[2].name}`, async () => {
    const scenario = ANALYST_SCENARIOS[2]
    const expectation = scenario.expectation as AnalystExpectation

    mockStructuredResponse = {
      hypotheses: [
        {
          description: "Memory leak from unbounded cache",
          category: "code_bug",
          confidence: 0.55,
          evidence: [
            {
              description: "Memory usage at 80%",
              direction: "supporting",
              strength: "moderate",
              verified: false,
              source: "metrics",
            },
          ],
          contradictions: [],
          reasoning: "Moderate evidence",
        },
        {
          description: "GC pressure from large objects",
          category: "infrastructure",
          confidence: 0.4,
          evidence: [
            {
              description: "GC pressure increasing",
              direction: "supporting",
              strength: "weak",
              verified: false,
              source: "metrics",
            },
          ],
          contradictions: [],
          reasoning: "Secondary hypothesis",
        },
      ],
      dataGaps: [],
      analysisSummary: "Moderate confidence analysis",
      confidenceAssessment: "Moderate confidence",
    } satisfies AnalystOutput

    const { createAnalystNode } = await import("../../agents/analyst/index.js")
    const node = createAnalystNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/analyst/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.hypotheses?.length).toBeGreaterThanOrEqual(expectation.minHypotheses)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
    expect(output.needsMoreData).toBe(false)
  })

  // Error handling
  it(`${ANALYST_SCENARIOS[3].name}`, async () => {
    const scenario = ANALYST_SCENARIOS[3]

    shouldThrow = true

    const { createAnalystNode } = await import("../../agents/analyst/index.js")
    const node = createAnalystNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/analyst/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.lastAgentResponse?.status).toBe("blocked")
    expect(output.lastAgentResponse?.recommendation).toBe("gatherer")
    expect(output.errors?.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// Gatherer Node Scenarios
// =============================================================================

describe("gatherer node scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shouldThrow = false
  })

  // Successful collection
  it(`${GATHERER_SCENARIOS[0].name}`, async () => {
    const scenario = GATHERER_SCENARIOS[0]
    const expectation = scenario.expectation as GathererExpectation

    mockStructuredResponse = {
      dataSummary: "Collected Render logs and GitHub commits for investigation",
      sourcesQueried: ["render", "github"],
      sourcesWithData: ["render", "github"],
      dataGaps: [],
      coverageAssessment: "sufficient",
    } satisfies GathererSummary

    const { createGathererNode } = await import("../../agents/gatherer/index.js")
    const node = createGathererNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/gatherer/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.lastAgentResponse?.status).toBe(expectation.status)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
    if (expectation.hasSummary) {
      expect(output.lastAgentResponse?.summary?.length).toBeGreaterThan(0)
    }
  })

  // Partial data with gaps
  it(`${GATHERER_SCENARIOS[1].name}`, async () => {
    const scenario = GATHERER_SCENARIOS[1]
    const expectation = scenario.expectation as GathererExpectation

    mockStructuredResponse = {
      dataSummary: "Collected Render logs but metrics unavailable",
      sourcesQueried: ["render"],
      sourcesWithData: ["render"],
      dataGaps: ["metrics"],
      coverageAssessment: "partial",
    } satisfies GathererSummary

    const { createGathererNode } = await import("../../agents/gatherer/index.js")
    const node = createGathererNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/gatherer/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.lastAgentResponse?.status).toBe(expectation.status)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
  })

  // Error handling
  it(`${GATHERER_SCENARIOS[2].name}`, async () => {
    const scenario = GATHERER_SCENARIOS[2]
    const expectation = scenario.expectation as GathererExpectation

    shouldThrow = true

    const { createGathererNode } = await import("../../agents/gatherer/index.js")
    const node = createGathererNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/gatherer/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.lastAgentResponse?.status).toBe(expectation.status)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
    expect(output.errors?.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// Resolver Node Scenarios
// =============================================================================

describe("resolver node scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shouldThrow = false
  })

  // Clear remediation
  it(`${RESOLVER_SCENARIOS[0].name}`, async () => {
    const scenario = RESOLVER_SCENARIOS[0]
    const expectation = scenario.expectation as ResolverExpectation

    mockStructuredResponse = {
      recommendations: [
        {
          title: "Restore null check in UserService.getProfile()",
          description: "Re-add the null check that was removed in the perf optimization commit",
          category: "code_fix",
          priority: "critical",
          urgency: "immediate",
          steps: [
            "Revert the null check removal in UserService.java:45",
            "Add null handling with fallback to database lookup",
            "Add unit test for cache miss scenario",
          ],
          estimatedEffort: "hours",
          precedentBased: true,
          riskLevel: "low",
          blastRadius: "UserService only",
          reversibility: "fully_reversible",
        },
      ],
      summary: "Restore null check removed during perf optimization",
      approachAssessment: "Low risk fix with precedent from similar incident",
    } satisfies ResolverOutput

    const { createResolverNode } = await import("../../agents/resolver/index.js")
    const node = createResolverNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/resolver/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.recommendations?.length).toBeGreaterThanOrEqual(expectation.minRecommendations)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)

    if (expectation.recommendationKeywords.length > 0) {
      const text = (output.recommendations ?? [])
        .map((r) => `${r.title} ${r.description}`.toLowerCase())
        .join(" ")
      for (const kw of expectation.recommendationKeywords) {
        expect(text).toContain(kw.toLowerCase())
      }
    }
  })

  // Multiple recommendations
  it(`${RESOLVER_SCENARIOS[1].name}`, async () => {
    const scenario = RESOLVER_SCENARIOS[1]
    const expectation = scenario.expectation as ResolverExpectation

    mockStructuredResponse = {
      recommendations: [
        {
          title: "Restore DB_POOL_SIZE to 100",
          description: "Revert the pool size config change",
          category: "config_change",
          priority: "critical",
          urgency: "immediate",
          steps: ["Update DB_POOL_SIZE env var to 100", "Redeploy"],
          estimatedEffort: "minutes",
          precedentBased: true,
          riskLevel: "low",
          blastRadius: "order-service",
          reversibility: "fully_reversible",
        },
        {
          title: "Add connection pool monitoring",
          description: "Set up alerts for pool utilization",
          category: "monitoring",
          priority: "medium",
          urgency: "short_term",
          steps: ["Configure pool utilization metric", "Set threshold alert"],
          estimatedEffort: "hours",
          precedentBased: false,
          riskLevel: "low",
          blastRadius: "Monitoring only",
          reversibility: "fully_reversible",
        },
      ],
      summary: "Restore pool config and add monitoring",
      approachAssessment: "Standard config restoration with monitoring improvement",
    } satisfies ResolverOutput

    const { createResolverNode } = await import("../../agents/resolver/index.js")
    const node = createResolverNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/resolver/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.recommendations?.length).toBeGreaterThanOrEqual(expectation.minRecommendations)
    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
  })

  // Insufficient context
  it(`${RESOLVER_SCENARIOS[2].name}`, async () => {
    const scenario = RESOLVER_SCENARIOS[2]
    const expectation = scenario.expectation as ResolverExpectation

    mockStructuredResponse = {
      recommendations: [],
      summary: "Insufficient data to produce recommendations",
      approachAssessment: "Cannot recommend without more investigation data",
    } satisfies ResolverOutput

    const { createResolverNode } = await import("../../agents/resolver/index.js")
    const node = createResolverNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/resolver/"],
    })

    const state = buildTestState(scenario.inputState)
    const output = await node(state)

    expect(output.lastAgentResponse?.recommendation).toBe(expectation.recommendation)
    expect(output.lastAgentResponse?.status).toBe("insufficient_context")
  })
})

// =============================================================================
// Supervisor Node Scenarios
// =============================================================================

describe("supervisor node scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shouldThrow = false
  })

  // Route to gatherer
  it(`${SUPERVISOR_SCENARIOS[0].name}`, async () => {
    const scenario = SUPERVISOR_SCENARIOS[0]
    const expectation = scenario.expectation as SupervisorExpectation

    mockStructuredResponse = {
      agent: "gatherer",
      reasoning: "Analyst needs more data",
    }

    const { supervisorNode } = await import("../../agents/supervisor/node.js")
    const state = buildTestState(scenario.inputState) as InvestigationState

    const mockConfig = {
      writer: vi.fn(),
      configurable: {},
    }

    const command = await supervisorNode(state, mockConfig as never)
    expect(command).toBeDefined()

    // Command.goto is an array (LangGraph wraps single values)
    const commandObj = command as unknown as { goto: string[]; update: Record<string, unknown> }
    expect(commandObj.goto).toContain(expectation.routeTo)
  })

  // Route to resolver
  it(`${SUPERVISOR_SCENARIOS[1].name}`, async () => {
    const scenario = SUPERVISOR_SCENARIOS[1]
    const expectation = scenario.expectation as SupervisorExpectation

    mockStructuredResponse = {
      agent: "resolver",
      reasoning: "High confidence analysis ready for resolution",
    }

    const { supervisorNode } = await import("../../agents/supervisor/node.js")
    const state = buildTestState(scenario.inputState) as InvestigationState

    const mockConfig = { writer: vi.fn(), configurable: {} }
    const command = await supervisorNode(state, mockConfig as never)

    const commandObj = command as unknown as { goto: string[]; update: Record<string, unknown> }
    expect(commandObj.goto).toContain(expectation.routeTo)
  })

  // Route to __end__
  it(`${SUPERVISOR_SCENARIOS[2].name}`, async () => {
    const scenario = SUPERVISOR_SCENARIOS[2]
    const expectation = scenario.expectation as SupervisorExpectation

    mockStructuredResponse = {
      agent: "__end__",
      reasoning: "Investigation complete",
    }

    const { supervisorNode } = await import("../../agents/supervisor/node.js")
    const state = buildTestState(scenario.inputState) as InvestigationState

    const mockConfig = { writer: vi.fn(), configurable: {} }
    const command = await supervisorNode(state, mockConfig as never)

    const commandObj = command as unknown as { goto: string[]; update: Record<string, unknown> }
    expect(commandObj.goto).toContain(expectation.routeTo)

    if (expectation.hasResult) {
      expect(commandObj.update.result).toBeDefined()
    }
  })

  // Iteration budget (safety guard — no LLM mock needed)
  it(`${SUPERVISOR_SCENARIOS[3].name}`, async () => {
    const scenario = SUPERVISOR_SCENARIOS[3]
    const expectation = scenario.expectation as SupervisorExpectation

    const { supervisorNode } = await import("../../agents/supervisor/node.js")
    const state = buildTestState(scenario.inputState) as InvestigationState

    const mockConfig = { writer: vi.fn(), configurable: {} }
    const command = await supervisorNode(state, mockConfig as never)

    const commandObj = command as unknown as { goto: string[]; update: Record<string, unknown> }
    expect(commandObj.goto).toContain(expectation.routeTo)
    expect(commandObj.update.result).toBeDefined()

    const result = commandObj.update.result as { status: string }
    expect(result.status).toBe("failed")
  })

  // Stall detection (safety guard — no LLM mock needed)
  it(`${SUPERVISOR_SCENARIOS[4].name}`, async () => {
    const scenario = SUPERVISOR_SCENARIOS[4]
    const expectation = scenario.expectation as SupervisorExpectation

    const { supervisorNode } = await import("../../agents/supervisor/node.js")
    const state = buildTestState(scenario.inputState) as InvestigationState

    const mockConfig = { writer: vi.fn(), configurable: {} }
    const command = await supervisorNode(state, mockConfig as never)

    const commandObj = command as unknown as { goto: string[]; update: Record<string, unknown> }
    expect(commandObj.goto).toContain(expectation.routeTo)
    expect(commandObj.update.result).toBeDefined()

    const result = commandObj.update.result as { status: string }
    expect(result.status).toBe("failed")
  })
})
