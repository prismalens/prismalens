import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHttpRequestTool } from "../../tools/http-request.js"
import type { IntegrationWithCredentials } from "../../types/contexts.js"

// Mock resolveIntegration to avoid needing real adapter registration
vi.mock("../../providers/integration-registry.js", () => ({
  resolveIntegration: (integration: IntegrationWithCredentials) => ({
    type: integration.type,
    connectionId: integration.id,
    baseUrl: "https://api.example.com",
    authHeaders: { Authorization: "Bearer test-token" },
    config: {},
  }),
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const testIntegration: IntegrationWithCredentials = {
  id: "conn-1",
  type: "render",
  config: {},
  credentials: { apiKey: "test-key" },
}

function makeSuccessResponse(body: string) {
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Return a fresh Response per call (Response body can only be read once)
  mockFetch.mockImplementation(() =>
    Promise.resolve(makeSuccessResponse('{"ok":true}')),
  )
})

describe("http_request guardrails", () => {
  describe("maxRequests budget", () => {
    it("allows requests within budget", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        maxRequests: 2,
      })

      const result1 = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(JSON.parse(result1)).toEqual({ ok: true })

      const result2 = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(JSON.parse(result2)).toEqual({ ok: true })
    })

    it("rejects requests when budget is exhausted", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        maxRequests: 1,
      })

      // First request succeeds
      await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })

      // Second request fails
      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      const parsed = JSON.parse(result)
      expect(parsed.error).toContain("budget exhausted")
    })

    it("allows unlimited requests when maxRequests is 0", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        maxRequests: 0,
      })

      for (let i = 0; i < 5; i++) {
        const result = await tool.invoke({
          integration: "render",
          method: "GET",
          path: "/v1/services",
        })
        expect(JSON.parse(result)).toEqual({ ok: true })
      }
    })
  })

  describe("allowedPaths", () => {
    it("allows paths matching a prefix", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        allowedPaths: { render: ["/v1/services"] },
      })

      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(JSON.parse(result)).toEqual({ ok: true })
    })

    it("allows sub-paths of a prefix", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        allowedPaths: { render: ["/v1/services"] },
      })

      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services/{serviceId}/logs",
        pathParams: { serviceId: "srv-123" },
      })
      expect(JSON.parse(result)).toEqual({ ok: true })
    })

    it("rejects paths not matching any prefix", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        allowedPaths: { render: ["/v1/services"] },
      })

      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/users",
      })
      const parsed = JSON.parse(result)
      expect(parsed.error).toContain("not allowed")
      expect(parsed.error).toContain("/v1/users")
    })

    it("allows all paths when no allowedPaths for integration type", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        allowedPaths: { github: ["/repos"] }, // different type
      })

      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/anything",
      })
      expect(JSON.parse(result)).toEqual({ ok: true })
    })

    it("allows all paths when allowedPaths is not set", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
      })

      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/any/path/at/all",
      })
      expect(JSON.parse(result)).toEqual({ ok: true })
    })
  })

  describe("configurable limits", () => {
    it("uses custom maxBodySize", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["POST"],
        limits: { maxBodySize: 10 },
      })

      const result = await tool.invoke({
        integration: "render",
        method: "POST",
        path: "/v1/services",
        body: { longValue: "x".repeat(20) },
      })
      const parsed = JSON.parse(result)
      expect(parsed.error).toContain("too large")
    })

    it("uses custom maxResponseSize for truncation", async () => {
      const longResponse = "x".repeat(200)
      mockFetch.mockResolvedValue(
        new Response(longResponse, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      )

      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        limits: { maxResponseSize: 50 },
      })

      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(result.length).toBeLessThan(200)
      expect(result).toContain("truncated")
    })
  })

  describe("budget only consumed on valid requests", () => {
    it("does not consume budget on rejected method calls", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        maxRequests: 1,
      })

      // Invalid method — does NOT consume budget
      const rejected = await tool.invoke({
        integration: "render",
        method: "DELETE",
        path: "/v1/services",
      })
      expect(JSON.parse(rejected).error).toContain("not allowed")

      // Valid call — should still work (budget not consumed by invalid call)
      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(JSON.parse(result)).toEqual({ ok: true })

      // Now budget is exhausted
      const exhausted = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(JSON.parse(exhausted).error).toContain("budget exhausted")
    })

    it("does not consume budget on rejected path calls", async () => {
      const tool = createHttpRequestTool([testIntegration], {
        allowedMethods: ["GET"],
        allowedPaths: { render: ["/v1/services"] },
        maxRequests: 1,
      })

      // Invalid path — does NOT consume budget
      await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/users",
      })

      // Valid call — should still work
      const result = await tool.invoke({
        integration: "render",
        method: "GET",
        path: "/v1/services",
      })
      expect(JSON.parse(result)).toEqual({ ok: true })
    })
  })
})
