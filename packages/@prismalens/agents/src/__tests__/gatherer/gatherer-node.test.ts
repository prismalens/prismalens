import { describe, it, expect } from "vitest"
import { createGathererNode } from "../../agents/gatherer/index.js"
import { buildInvestigationGraph } from "../../graph/investigation-graph.js"
import { StubDataProvider } from "../../providers/data-provider.js"
import type { IntegrationContext } from "../../types/contexts.js"

const githubIntegration: IntegrationContext = {
  id: "gh-1",
  name: "GitHub",
  type: "github",
  enabled: true,
  config: {},
}

describe("createGathererNode", () => {
  it("returns a function", () => {
    const node = createGathererNode([])
    expect(typeof node).toBe("function")
  })

  it("accepts integrations and mcpTools parameters", () => {
    const node = createGathererNode([githubIntegration], [])
    expect(typeof node).toBe("function")
  })

  it("returns a function with no mcpTools parameter", () => {
    const node = createGathererNode([])
    expect(typeof node).toBe("function")
  })
})

describe("investigation graph with gatherer", () => {
  it("compiles successfully with gatherer node wired", () => {
    const graph = buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: [],
      mcpTools: [],
    })

    expect(graph).toBeDefined()
    // Graph should have compiled without errors
    expect(typeof graph.invoke).toBe("function")
  })
})
