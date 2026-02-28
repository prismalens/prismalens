import { describe, it, expect } from "vitest"
import { createGathererNode } from "../../agents/gatherer/index.js"
import type { BackendProtocol } from "deepagents"

const mockBackend = {} as BackendProtocol
const mockHttpRequestTool = { name: "http_request" } as never

describe("createGathererNode", () => {
  it("returns a function", () => {
    const node = createGathererNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/gatherer/"],
    })
    expect(typeof node).toBe("function")
  })

  it("accepts all dependency parameters", () => {
    const node = createGathererNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/common/", "/skills/gatherer/"],
    })
    expect(typeof node).toBe("function")
  })
})
