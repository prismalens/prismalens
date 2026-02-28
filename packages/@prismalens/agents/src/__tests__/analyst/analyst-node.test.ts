import { describe, it, expect } from "vitest"
import { createAnalystNode } from "../../agents/analyst/index.js"
import type { BackendProtocol } from "deepagents"

const mockBackend = {} as BackendProtocol
const mockHttpRequestTool = { name: "http_request" } as never

describe("createAnalystNode", () => {
  it("returns a function", () => {
    const node = createAnalystNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/analyst/"],
    })
    expect(typeof node).toBe("function")
  })

  it("accepts all dependency parameters", () => {
    const node = createAnalystNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/common/", "/skills/analyst/"],
    })
    expect(typeof node).toBe("function")
  })
})
