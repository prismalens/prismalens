import { describe, it, expect } from "vitest"
import { createResolverNode } from "../../agents/resolver/index.js"
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

describe("createResolverNode", () => {
  it("returns a function", () => {
    const node = createResolverNode([])
    expect(typeof node).toBe("function")
  })

  it("accepts integrations and mcpTools parameters", () => {
    const node = createResolverNode([githubIntegration], [])
    expect(typeof node).toBe("function")
  })

  it("returns a function with no mcpTools parameter", () => {
    const node = createResolverNode([])
    expect(typeof node).toBe("function")
  })
})

describe("investigation graph with resolver node", () => {
  it("compiles successfully with resolver node wired", () => {
    const graph = buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: [],
      mcpTools: [],
    })

    expect(graph).toBeDefined()
    expect(typeof graph.invoke).toBe("function")
  })
})
