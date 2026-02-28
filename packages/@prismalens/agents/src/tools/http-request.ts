/**
 * Generic http_request tool for all REST API calls.
 *
 * A single LangChain StructuredTool shared by all agents. Credentials
 * are bound via closure at graph build time — never exposed to the agent.
 *
 * Usage:
 *   http_request({ integration: "render", method: "GET", path: "/v1/services" })
 *   → auto-injects auth, calls https://api.render.com/v1/services, returns JSON
 */

import { z } from "zod"
import { StructuredTool } from "@langchain/core/tools"
import type { IntegrationWithCredentials } from "../types/contexts.js"
import { resolveIntegration } from "../providers/integration-registry.js"
import type { ResolvedIntegration } from "../providers/integration-registry.js"

/** All supported HTTP methods */
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type HttpMethod = (typeof ALL_METHODS)[number]

const HttpRequestSchema = z.object({
  integration: z
    .string()
    .describe("Integration type name (e.g., 'render', 'github')"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .describe("HTTP method"),
  path: z
    .string()
    .describe("API path with optional {param} placeholders (e.g., '/v1/services/{serviceId}/logs')"),
  pathParams: z
    .record(z.string())
    .optional()
    .describe("Values for path parameter placeholders"),
  queryParams: z
    .record(z.string())
    .optional()
    .describe("URL query parameters"),
  body: z
    .unknown()
    .optional()
    .describe("Request body for POST/PUT/PATCH"),
  headers: z
    .record(z.string())
    .optional()
    .describe("Additional request headers"),
})

type HttpRequestInput = z.infer<typeof HttpRequestSchema>

/**
 * Substitute path parameters: "/v1/services/{serviceId}" + { serviceId: "abc" }
 * → "/v1/services/abc"
 */
function substitutePath(path: string, params?: Record<string, string>): string {
  if (!params) return path
  return path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) {
      throw new Error(`Missing path parameter: ${key}`)
    }
    return encodeURIComponent(value)
  })
}

/**
 * Build the full URL from base, path, and query params.
 * Rejects absolute URLs in path to prevent SSRF — path must be relative.
 */
function buildUrl(
  baseUrl: string,
  path: string,
  queryParams?: Record<string, string>,
): string {
  if (/^[a-z]+:\/\//i.test(path) || path.startsWith("//")) {
    throw new Error("Absolute URLs are not allowed in path parameter")
  }

  const base = new URL(baseUrl)
  const url = new URL(path, baseUrl)

  // Defense in depth: verify origin was not changed by path
  if (url.origin !== base.origin) {
    throw new Error(`URL origin mismatch: expected ${base.origin}, got ${url.origin}`)
  }

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

/** Max request body size in characters */
const MAX_BODY_SIZE = 10_000

/** HTTP request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Options for creating an http_request tool instance.
 */
export interface HttpRequestToolOptions {
  /**
   * HTTP methods the agent is allowed to use.
   * Defaults to ["GET"] — read-only by default for safety.
   * Use ["GET", "POST"] for agents that need query-style POST APIs (e.g., Prometheus).
   */
  allowedMethods?: HttpMethod[]
}

/**
 * Create the http_request tool with credentials bound via closure.
 *
 * @param integrations - Integrations with decrypted credentials (from DB)
 * @param options - Method allowlist and other restrictions
 * @returns StructuredTool that agents can call to make authenticated API requests
 */
export function createHttpRequestTool(
  integrations: IntegrationWithCredentials[],
  options: HttpRequestToolOptions = {},
): StructuredTool {
  const allowedMethods = options.allowedMethods ?? ["GET"]

  // Pre-resolve integrations at build time
  const resolvedMap = new Map<string, ResolvedIntegration>()
  for (const integration of integrations) {
    if (resolvedMap.has(integration.type)) continue // first connection per type wins
    const resolved = resolveIntegration(integration)
    if (resolved) {
      resolvedMap.set(integration.type, resolved)
    }
  }

  const availableIntegrations = [...resolvedMap.keys()].join(", ")

  return new HttpRequestTool(resolvedMap, availableIntegrations, allowedMethods)
}

class HttpRequestTool extends StructuredTool {
  name = "http_request"
  description: string
  schema = HttpRequestSchema

  private resolvedMap: Map<string, ResolvedIntegration>
  private allowedMethods: Set<string>

  constructor(
    resolvedMap: Map<string, ResolvedIntegration>,
    availableIntegrations: string,
    allowedMethods: HttpMethod[],
  ) {
    super()
    this.resolvedMap = resolvedMap
    this.allowedMethods = new Set(allowedMethods)
    const methodsList = allowedMethods.join(", ")
    this.description =
      `Make authenticated HTTP requests to external APIs. ` +
      `Available integrations: ${availableIntegrations || "none"}. ` +
      `Allowed methods: ${methodsList}. ` +
      `Auth is injected automatically — never include credentials in requests. ` +
      `Check the OpenAPI spec in /workspace/specs/ for available endpoints.`
  }

  async _call(input: HttpRequestInput): Promise<string> {
    if (!this.allowedMethods.has(input.method)) {
      return JSON.stringify({
        error: `Method ${input.method} is not allowed. Allowed methods: ${[...this.allowedMethods].join(", ")}`,
      })
    }

    const resolved = this.resolvedMap.get(input.integration)
    if (!resolved) {
      return JSON.stringify({
        error: `Unknown integration: ${input.integration}. Available: ${[...this.resolvedMap.keys()].join(", ")}`,
      })
    }

    try {
      const resolvedPath = substitutePath(input.path, input.pathParams)
      const url = buildUrl(resolved.baseUrl, resolvedPath, input.queryParams)

      // Build set of auth header names to strip from agent input (case-insensitive)
      const authHeaderNames = new Set(
        Object.keys(resolved.authHeaders).map((h) => h.toLowerCase()),
      )
      // Always strip "authorization" even if not in authHeaders
      authHeaderNames.add("authorization")

      const safeHeaders: Record<string, string> = {}
      if (input.headers) {
        for (const [key, value] of Object.entries(input.headers)) {
          if (authHeaderNames.has(key.toLowerCase())) continue
          safeHeaders[key] = value
        }
      }

      const headers: Record<string, string> = {
        "Accept": "application/json",
        ...safeHeaders,
        // Auth headers applied last — always win over agent-supplied headers
        ...resolved.authHeaders,
      }

      let bodyStr: string | undefined
      if (input.body && ["POST", "PUT", "PATCH"].includes(input.method)) {
        bodyStr = JSON.stringify(input.body)
        if (bodyStr.length > MAX_BODY_SIZE) {
          return JSON.stringify({
            error: `Request body too large: ${bodyStr.length} chars (max ${MAX_BODY_SIZE})`,
          })
        }
        headers["Content-Type"] = "application/json"
      }

      const response = await fetch(url, {
        method: input.method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      const text = await response.text()

      // Truncate very large responses to keep context manageable
      const MAX_RESPONSE_SIZE = 50_000
      const truncated = text.length > MAX_RESPONSE_SIZE
        ? text.slice(0, MAX_RESPONSE_SIZE) + "\n...[truncated]"
        : text

      if (!response.ok) {
        return JSON.stringify({
          error: `HTTP ${response.status} ${response.statusText}`,
          body: truncated,
        })
      }

      // Try to parse as JSON, fall back to raw text
      try {
        return JSON.stringify(JSON.parse(truncated))
      } catch {
        return truncated
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify({ error: `Request failed: ${message}` })
    }
  }
}
