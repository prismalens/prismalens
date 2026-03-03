import { describe, it, expect, vi, beforeEach } from "vitest"
import type { OpenAPIV3 } from "openapi-types"
import { join } from "node:path"

import {
  OpenApiToolkit,
  globToRegex,
  extractEndpoints,
  extractSecurity,
} from "../../tools/openapi-toolkit.js"

// ─── Fixture: minimal OpenAPI 3.0 spec ────────────────────────────────────────

function makeSpec(overrides: Partial<OpenAPIV3.Document> = {}): OpenAPIV3.Document {
  return {
    openapi: "3.0.3",
    info: { title: "Test API", version: "1.0.0" },
    servers: [{ url: "https://api.test.com/v1" }],
    paths: {
      "/services": {
        get: {
          operationId: "list_services",
          summary: "List services",
          description: "List all services for the user",
          tags: ["services"],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20 },
              description: "Max results",
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/services/{serviceId}": {
        get: {
          operationId: "get_service",
          summary: "Get service details",
          description: "Get details for a specific service",
          tags: ["services"],
          parameters: [
            {
              name: "serviceId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Service ID",
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/services/{serviceId}/logs": {
        get: {
          operationId: "get_service_logs",
          summary: "Get service logs",
          description: "Retrieves log output for a specific service",
          tags: ["logs"],
          parameters: [
            {
              name: "serviceId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100 },
              description: "Max log lines",
            },
            {
              name: "direction",
              in: "query",
              schema: { type: "string", enum: ["backward", "forward"] },
              description: "Log direction",
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/services/{serviceId}/deploys": {
        get: {
          operationId: "list_deploys",
          summary: "List deployments",
          tags: ["deploys"],
          parameters: [
            {
              name: "serviceId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/services/{serviceId}/events": {
        get: {
          operationId: "list_events",
          summary: "List service events",
          tags: ["events"],
          parameters: [
            {
              name: "serviceId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/logs": {
        get: {
          operationId: "get_logs",
          summary: "Get logs",
          description: "Get logs for resources",
          tags: ["logs"],
          parameters: [
            {
              name: "ownerId",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Owner ID",
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    ...overrides,
  } as OpenAPIV3.Document
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("globToRegex", () => {
  it("matches single segment wildcard", () => {
    const re = globToRegex("/services/*/logs")
    expect(re.test("/services/abc/logs")).toBe(true)
    expect(re.test("/services/123/logs")).toBe(true)
    expect(re.test("/services/abc/def/logs")).toBe(false)
  })

  it("matches globstar (any depth)", () => {
    const re = globToRegex("/services/**")
    expect(re.test("/services/abc")).toBe(true)
    expect(re.test("/services/abc/logs")).toBe(true)
    expect(re.test("/services/abc/def/ghi")).toBe(true)
  })

  it("matches exact path", () => {
    const re = globToRegex("/services")
    expect(re.test("/services")).toBe(true)
    expect(re.test("/services/abc")).toBe(false)
  })

  it("escapes special regex chars", () => {
    const re = globToRegex("/services/{serviceId}")
    expect(re.test("/services/{serviceId}")).toBe(true)
    expect(re.test("/services/abc")).toBe(false)
  })
})

describe("extractEndpoints", () => {
  it("extracts all endpoints with methods and paths", () => {
    const { endpoints } = extractEndpoints(makeSpec())
    expect(endpoints).toHaveLength(6)
    expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      "GET /services",
      "GET /services/{serviceId}",
      "GET /services/{serviceId}/logs",
      "GET /services/{serviceId}/deploys",
      "GET /services/{serviceId}/events",
      "GET /logs",
    ])
  })

  it("extracts title and serverUrl", () => {
    const { title, serverUrl } = extractEndpoints(makeSpec())
    expect(title).toBe("Test API")
    expect(serverUrl).toBe("https://api.test.com/v1")
  })

  it("extracts parameters with types and defaults", () => {
    const { endpoints } = extractEndpoints(makeSpec())
    const logs = endpoints.find((e) => e.path === "/services/{serviceId}/logs")
    expect(logs).toBeDefined()
    expect(logs?.parameters).toEqual([
      { name: "serviceId", in: "path", required: true, type: "string", description: undefined, enum: undefined, default: undefined },
      { name: "limit", in: "query", required: false, type: "integer", description: "Max log lines", enum: undefined, default: 100 },
      { name: "direction", in: "query", required: false, type: "string", description: "Log direction", enum: ["backward", "forward"], default: undefined },
    ])
  })

  it("extracts global security", () => {
    const { globalSecurity } = extractEndpoints(makeSpec())
    expect(globalSecurity).toHaveLength(1)
    expect(globalSecurity[0].scheme).toBe("bearerAuth")
    expect(globalSecurity[0].type).toBe("http")
    expect(globalSecurity[0].details).toContain("Bearer")
  })

  it("handles spec with no servers", () => {
    const { serverUrl } = extractEndpoints(makeSpec({ servers: undefined }))
    expect(serverUrl).toBe("")
  })

  it("handles spec with no security", () => {
    const { globalSecurity } = extractEndpoints(
      makeSpec({ security: undefined, components: undefined }),
    )
    expect(globalSecurity).toHaveLength(0)
  })
})

describe("extractSecurity", () => {
  it("extracts bearer auth", () => {
    const { schemes } = extractSecurity(makeSpec())
    expect(schemes.has("bearerAuth")).toBe(true)
    const bearer = schemes.get("bearerAuth")
    expect(bearer?.type).toBe("http")
    expect(bearer?.details).toContain("Bearer token")
  })

  it("extracts API key auth", () => {
    const doc = makeSpec({
      components: {
        securitySchemes: {
          apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
        },
      },
      security: [{ apiKey: [] }],
    } as Partial<OpenAPIV3.Document>)

    const { global: globalSec } = extractSecurity(doc)
    expect(globalSec).toHaveLength(1)
    expect(globalSec[0].details).toContain("API key in header X-API-Key")
  })

  it("handles no security schemes", () => {
    const { schemes, global: globalSec } = extractSecurity(
      makeSpec({ components: undefined, security: undefined }),
    )
    expect(schemes.size).toBe(0)
    expect(globalSec).toHaveLength(0)
  })
})

describe("OpenApiToolkit", () => {
  describe("create", () => {
    it("creates from specObj", async () => {
      const toolkit = await OpenApiToolkit.create({
        specObj: makeSpec() as unknown as Record<string, unknown>,
      })
      expect(toolkit.tools).toHaveLength(1)
      expect(toolkit.tools[0].name).toBe("api_routes")
    })

    it("creates from specPath (JSON file)", async () => {
      const specPath = join(
        import.meta.dirname,
        "../../../specs/render-openapi.json",
      )
      const toolkit = await OpenApiToolkit.create({ specPath })
      expect(toolkit.tools).toHaveLength(1)
      expect(toolkit.tools[0].name).toBe("api_routes")
    })

    it("creates from specUrl (mocked fetch)", async () => {
      const spec = makeSpec()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(spec),
      })
      vi.stubGlobal("fetch", mockFetch)

      try {
        const toolkit = await OpenApiToolkit.create({
          specUrl: "https://example.com/spec.json",
        })
        expect(toolkit.tools).toHaveLength(1)
        expect(mockFetch).toHaveBeenCalledWith(
          "https://example.com/spec.json",
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        )
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it("throws when no spec source provided", async () => {
      await expect(OpenApiToolkit.create({})).rejects.toThrow(
        "exactly one of specUrl, specPath, or specObj is required",
      )
    })

    it("throws when multiple spec sources provided", async () => {
      await expect(
        OpenApiToolkit.create({
          specObj: makeSpec() as unknown as Record<string, unknown>,
          specPath: "/some/path.json",
        }),
      ).rejects.toThrow("only one of specUrl, specPath, or specObj may be provided")
    })

    it("uses custom name prefix", async () => {
      const toolkit = await OpenApiToolkit.create({
        name: "render",
        specObj: makeSpec() as unknown as Record<string, unknown>,
      })
      expect(toolkit.tools[0].name).toBe("render_routes")
    })

    it("applies allowedPaths filter", async () => {
      const toolkit = await OpenApiToolkit.create({
        specObj: makeSpec() as unknown as Record<string, unknown>,
        allowedPaths: ["/services", "/services/*/logs"],
      })
      const tool = toolkit.tools[0]
      const result = await tool.invoke({})
      // Should only show /services and /services/{serviceId}/logs
      expect(result).toContain("/services")
      expect(result).toContain("/logs")
      expect(result).not.toContain("/deploys")
      expect(result).not.toContain("/events")
    })

    it("applies disallowedPaths filter", async () => {
      const toolkit = await OpenApiToolkit.create({
        specObj: makeSpec() as unknown as Record<string, unknown>,
        disallowedPaths: ["/services/*/events"],
      })
      const tool = toolkit.tools[0]
      const result = await tool.invoke({})
      expect(result).not.toContain("List service events")
    })

    it("combines allow + disallow filters", async () => {
      const toolkit = await OpenApiToolkit.create({
        specObj: makeSpec() as unknown as Record<string, unknown>,
        allowedPaths: ["/services/**"],
        disallowedPaths: ["/services/*/events"],
      })
      const tool = toolkit.tools[0]
      const result = await tool.invoke({})
      expect(result).toContain("/services")
      expect(result).toContain("/logs")
      expect(result).not.toContain("List service events")
      // /logs (root) should be excluded by allowedPaths
      expect(result).not.toContain("GET,/logs")
    })
  })

  describe("routes tool", () => {
    let tool: Awaited<ReturnType<typeof OpenApiToolkit.create>>["tools"][0]

    beforeEach(async () => {
      const toolkit = await OpenApiToolkit.create({
        name: "test",
        specObj: makeSpec() as unknown as Record<string, unknown>,
      })
      tool = toolkit.tools[0]
    })

    describe("listing", () => {
      it("no args: lists all endpoints in TOON format", async () => {
        const result = await tool.invoke({})
        // 6 endpoints — compact listing (>5)
        expect(result).toContain("Test API")
        expect(result).toContain("https://api.test.com/v1")
        expect(result).toContain("GET")
        expect(result).toContain("/services")
      })

      it("includes serverUrl and auth info", async () => {
        const result = await tool.invoke({})
        expect(result).toContain("https://api.test.com/v1")
        expect(result).toContain("Bearer")
      })

      it("groups by tag when spec has tags", async () => {
        const result = await tool.invoke({})
        // Should have tag headers
        expect(result).toContain("## services")
        expect(result).toContain("## logs")
        expect(result).toContain("## deploys")
        expect(result).toContain("## events")
      })

      it("summary only (no descriptions) for >5 results", async () => {
        const result = await tool.invoke({})
        // Should have summaries
        expect(result).toContain("List services")
        expect(result).toContain("Get service logs")
        // Should NOT have full descriptions
        expect(result).not.toContain("List all services for the user")
        expect(result).not.toContain("Retrieves log output for a specific service")
      })
    })

    describe("filter", () => {
      it("keyword: matches path, summary, tags", async () => {
        const result = await tool.invoke({ filter: "logs" })
        // Should match /services/{serviceId}/logs and /logs
        expect(result).toContain("/logs")
        expect(result).toContain("Get service logs")
        expect(result).toContain("Get logs")
      })

      it("glob: /services/*/logs matches /services/{serviceId}/logs", async () => {
        const result = await tool.invoke({ filter: "/services/*/logs" })
        expect(result).toContain("/services/{serviceId}/logs")
        expect(result).not.toContain("/services/{serviceId}/deploys")
      })

      it("glob: /services/** matches all nested paths", async () => {
        const result = await tool.invoke({ filter: "/services/**" })
        expect(result).toContain("/services/{serviceId}")
        expect(result).toContain("/services/{serviceId}/logs")
        expect(result).toContain("/services/{serviceId}/deploys")
        expect(result).toContain("/services/{serviceId}/events")
      })

      it("no match: returns helpful message", async () => {
        const result = await tool.invoke({ filter: "nonexistent" })
        expect(result).toContain("No endpoints match")
        expect(result).toContain("broader search")
      })
    })

    describe("adaptive detail", () => {
      it(">5 results: compact listing", async () => {
        const result = await tool.invoke({})
        // 6 endpoints — grouped by tag, no parameter details
        expect(result).toContain("##")
        expect(result).not.toContain("pathParams")
        expect(result).not.toContain("queryParams")
      })

      it("1-5 results: includes parameters inline", async () => {
        // "logs" matches 2 endpoints
        const result = await tool.invoke({ filter: "logs" })
        expect(result).toContain("matchCount: 2")
      })

      it("1 result: full detail with description", async () => {
        const result = await tool.invoke({ filter: "/services/*/logs" })
        // Single result — full detail
        expect(result).toContain("method: GET")
        expect(result).toContain("/services/{serviceId}/logs")
        expect(result).toContain("Retrieves log output")
      })
    })

    describe("path lookup", () => {
      it("exact path returns full detail", async () => {
        const result = await tool.invoke({ path: "/services/{serviceId}/logs" })
        expect(result).toContain("method: GET")
        expect(result).toContain("/services/{serviceId}/logs")
        expect(result).toContain("Retrieves log output")
        expect(result).toContain("serviceId")
      })

      it("partial match suggests alternatives", async () => {
        // "/services" exists, so "/services/{serviceId}/logs" includes "/services/"
        const result = await tool.invoke({ path: "/services/{serviceId}" })
        // Exact match exists, should return full detail
        expect(result).toContain("method: GET")
        expect(result).toContain("Get service details")
      })

      it("non-matching path with partial substring suggests alternatives", async () => {
        // Use a path that is a substring of existing paths
        const result = await tool.invoke({ path: "/deploys" })
        // /deploys is contained in /services/{serviceId}/deploys
        expect(result).toContain("No exact match")
        expect(result).toContain("Did you mean")
      })

      it("no match returns helpful message", async () => {
        const result = await tool.invoke({ path: "/nonexistent" })
        expect(result).toContain("No endpoint found")
        expect(result).toContain("Use filter to search")
      })
    })

    describe("security", () => {
      it("global security in tool description", () => {
        expect(tool.description).toContain("Bearer")
        expect(tool.description).toContain("Auth:")
      })

      it("per-endpoint security in detail view", async () => {
        const spec = makeSpec()
        // Add per-operation security
        const getService = (spec.paths["/services/{serviceId}"] as OpenAPIV3.PathItemObject)
          .get as OpenAPIV3.OperationObject
        getService.security = [{ bearerAuth: ["read:services"] }]

        const toolkit = await OpenApiToolkit.create({
          specObj: spec as unknown as Record<string, unknown>,
        })
        const routesTool = toolkit.tools[0]
        const result = await routesTool.invoke({ path: "/services/{serviceId}" })
        expect(result).toContain("security")
        expect(result).toContain("Bearer")
      })

      it("no security: omitted gracefully", async () => {
        const toolkit = await OpenApiToolkit.create({
          specObj: makeSpec({
            components: undefined,
            security: undefined,
          }) as unknown as Record<string, unknown>,
        })
        const routesTool = toolkit.tools[0]
        expect(routesTool.description).toContain("None specified")
      })
    })

    describe("naming", () => {
      it("custom name: 'myapi' → 'myapi_routes'", async () => {
        const toolkit = await OpenApiToolkit.create({
          name: "myapi",
          specObj: makeSpec() as unknown as Record<string, unknown>,
        })
        expect(toolkit.tools[0].name).toBe("myapi_routes")
      })

      it("default name: 'api_routes'", async () => {
        const toolkit = await OpenApiToolkit.create({
          specObj: makeSpec() as unknown as Record<string, unknown>,
        })
        expect(toolkit.tools[0].name).toBe("api_routes")
      })
    })
  })
})
