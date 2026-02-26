import { describe, it, expect } from "vitest"
import { createAnalystNode } from "../../agents/analyst/index.js"
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

describe("createAnalystNode", () => {
  it("returns a function", () => {
    const node = createAnalystNode([])
    expect(typeof node).toBe("function")
  })

  it("accepts integrations and mcpTools parameters", () => {
    const node = createAnalystNode([githubIntegration], [])
    expect(typeof node).toBe("function")
  })

  it("returns a function with no mcpTools parameter", () => {
    const node = createAnalystNode([])
    expect(typeof node).toBe("function")
  })
})

describe("investigation graph with analyst node", () => {
  it("compiles successfully with analyst node wired", () => {
    const graph = buildInvestigationGraph({
      dataProvider: new StubDataProvider(),
      integrations: [],
      mcpTools: [],
    })

    expect(graph).toBeDefined()
    expect(typeof graph.invoke).toBe("function")
  })
})
