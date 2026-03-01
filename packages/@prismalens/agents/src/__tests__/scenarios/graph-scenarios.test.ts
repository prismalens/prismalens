/**
 * Graph-level scenario tests (deterministic).
 *
 * LLM + deepagents mocked. Tests graph wiring, trajectory structure,
 * and scenario completion. Fast (<5s).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { filterScenarios } from "./catalog/index.js"
import type { ScenarioDefinition } from "./types.js"

// Track LLM invocation count for counter-based mock routing
let llmCallCount = 0

vi.mock("../../llm/factory.js", () => ({
  createLLM: vi.fn(() => ({
    withStructuredOutput: vi.fn(() => ({
      invoke: vi.fn(async () => {
        llmCallCount++
        // First supervisor call: route to resolver (analyst has hypotheses)
        if (llmCallCount === 1) {
          return {
            agent: "resolver",
            reasoning: "Analyst produced hypotheses, routing to resolver",
          }
        }
        // Subsequent calls: end investigation
        return {
          agent: "__end__",
          reasoning: "Investigation complete",
        }
      }),
    })),
  })),
}))

vi.mock("deepagents", () => ({
  createDeepAgent: vi.fn(() => ({
    invoke: vi.fn(async () => ({
      messages: [],
      structuredResponse: {
        // Analyst response shape
        hypotheses: [
          {
            description: "Root cause identified from scenario data",
            category: "code_bug",
            confidence: 0.75,
            evidence: [
              {
                description: "Error logs show the failure pattern",
                direction: "supporting",
                strength: "strong",
                verified: false,
                source: "logs",
              },
            ],
            contradictions: [],
            reasoning: "Log evidence strongly supports this hypothesis",
          },
        ],
        dataGaps: [],
        analysisSummary: "Analysis completed with high confidence",
        confidenceAssessment: "High confidence based on available evidence",
        // Gatherer response fields (used when gatherer node runs)
        dataSummary: "Collected scenario test data",
        sourcesQueried: ["logs"],
        sourcesWithData: ["logs"],
        coverageAssessment: "sufficient",
        // Resolver response fields (used when resolver node runs)
        recommendations: [
          {
            title: "Fix the identified issue",
            description: "Apply the recommended fix based on root cause analysis",
            category: "code_fix",
            priority: "high",
            urgency: "immediate",
            steps: ["Identify the bug", "Apply fix", "Deploy"],
            estimatedEffort: "hours",
            precedentBased: false,
            riskLevel: "medium",
            blastRadius: "Single service",
            reversibility: "fully_reversible",
          },
        ],
        summary: "Recommended fix based on analysis",
        approachAssessment: "Standard fix approach",
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

vi.mock("../../config/workspace.js", () => ({
  createWorkspaceDir: vi.fn(async () => "/tmp/test-workspace"),
  injectSpecFiles: vi.fn(async () => {}),
  cleanupWorkspaceDir: vi.fn(async () => {}),
  getWorkspacePath: vi.fn(() => "/tmp/test-workspace"),
}))

// =============================================================================
// Deterministic Graph-Level Scenarios
// =============================================================================

describe("graph-level scenarios (deterministic)", () => {
  beforeEach(() => {
    llmCallCount = 0
    vi.clearAllMocks()
  })

  const easyScenarios = filterScenarios({ difficulty: "easy" })
  const mediumScenarios = filterScenarios({ difficulty: "medium" })

  describe.each(easyScenarios)("EASY: $name", (scenario: ScenarioDefinition) => {
    it("graph completes with a result", async () => {
      const { runScenario } = await import("./runner.js")
      const result = await runScenario(scenario)

      expect(result.result).toBeDefined()
      expect(result.result?.status).toBeDefined()
      expect(result.trajectory.length).toBeGreaterThanOrEqual(3)
      expect(result.durationMs).toBeLessThan(30_000)
      expect(result.scenarioId).toBe(scenario.id)
    })
  })

  describe.each(mediumScenarios)("MEDIUM: $name", (scenario: ScenarioDefinition) => {
    it("graph completes with a result", async () => {
      const { runScenario } = await import("./runner.js")
      const result = await runScenario(scenario)

      expect(result.result).toBeDefined()
      expect(result.result?.status).toBeDefined()
    })
  })
})
