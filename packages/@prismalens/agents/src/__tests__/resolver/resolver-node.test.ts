import { describe, it, expect } from "vitest"
import { createResolverNode } from "../../agents/resolver/index.js"
import type { BackendProtocol } from "deepagents"

const mockBackend = {} as BackendProtocol
const mockHttpRequestTool = { name: "http_request" } as never

describe("createResolverNode", () => {
  it("returns a function", () => {
    const node = createResolverNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/resolver/"],
    })
    expect(typeof node).toBe("function")
  })

  it("accepts all dependency parameters", () => {
    const node = createResolverNode({
      backend: mockBackend,
      httpRequestTool: mockHttpRequestTool,
      mcpTools: [],
      skills: ["/skills/common/", "/skills/resolver/"],
    })
    expect(typeof node).toBe("function")
  })
})
