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
import { getGraphConfig } from "../config/env.js"
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

/** Default limits for http_request tool (from env or Zod defaults) */
function getDefaultLimits() {
  const cfg = getGraphConfig()
  return {
    maxBodySize: cfg.PRISMALENS_HTTP_MAX_BODY_SIZE,
    requestTimeoutMs: cfg.PRISMALENS_HTTP_TIMEOUT_MS,
    maxResponseSize: cfg.PRISMALENS_HTTP_MAX_RESPONSE_SIZE,
  }
}

/**
 * Configurable limits for HTTP requests.
 */
export interface HttpRequestLimits {
  /** Max request body size in characters (default 10_000) */
  maxBodySize?: number
  /** HTTP request timeout in milliseconds (default 30_000) */
  requestTimeoutMs?: number
  /** Max response size in characters before truncation (default 50_000) */
  maxResponseSize?: number
}

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

  /**
   * Allowed path prefixes per integration type.
   * If set for a given integration type, only paths starting with one of the
   * prefixes are permitted. Uses `startsWith` — simple, auditable, no regex.
   * Empty map or absent = all paths allowed (open by default).
   */
  allowedPaths?: Record<string, string[]>

  /**
   * Request budget. 0 = unlimited (default).
   * Counter resets naturally per-investigation (graph-per-investigation pattern).
   */
  maxRequests?: number

  /** Override default limits for body size, timeout, and response size. */
  limits?: HttpRequestLimits
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

  // Build allowed paths map
  const allowedPaths = new Map<string, string[]>()
  if (options.allowedPaths) {
    for (const [type, prefixes] of Object.entries(options.allowedPaths)) {
      allowedPaths.set(type, prefixes)
    }
  }

  // Resolve limits with defaults from env
  const defaults = getDefaultLimits()
  const limits = {
    maxBodySize: options.limits?.maxBodySize ?? defaults.maxBodySize,
    requestTimeoutMs: options.limits?.requestTimeoutMs ?? defaults.requestTimeoutMs,
    maxResponseSize: options.limits?.maxResponseSize ?? defaults.maxResponseSize,
  }

  return new HttpRequestTool(
    resolvedMap,
    availableIntegrations,
    allowedMethods,
    allowedPaths,
    options.maxRequests ?? 0,
    limits,
  )
}

/** Resolved limits with all defaults applied */
interface ResolvedLimits {
  maxBodySize: number
  requestTimeoutMs: number
  maxResponseSize: number
}

class HttpRequestTool extends StructuredTool {
  name = "http_request"
  description: string
  schema = HttpRequestSchema

  private resolvedMap: Map<string, ResolvedIntegration>
  private allowedMethods: Set<string>
  private allowedPaths: Map<string, string[]>
  private maxRequests: number
  private requestCount = 0
  private limits: ResolvedLimits

  constructor(
    resolvedMap: Map<string, ResolvedIntegration>,
    availableIntegrations: string,
    allowedMethods: HttpMethod[],
    allowedPaths: Map<string, string[]>,
    maxRequests: number,
    limits: ResolvedLimits,
  ) {
    super()
    this.resolvedMap = resolvedMap
    this.allowedMethods = new Set(allowedMethods)
    this.allowedPaths = allowedPaths
    this.maxRequests = maxRequests
    this.limits = limits

    const methodsList = allowedMethods.join(", ")
    const budgetNote = maxRequests > 0 ? ` Budget: ${maxRequests} requests.` : ""
    this.description =
      `Make authenticated HTTP requests to external APIs. ` +
      `Available integrations: ${availableIntegrations || "none"}. ` +
      `Allowed methods: ${methodsList}.${budgetNote} ` +
      `Auth is injected automatically — never include credentials in requests. ` +
      `Check the OpenAPI spec in /specs/ for available endpoints.`
  }

  async _call(input: HttpRequestInput): Promise<string> {
    // 1. Method check (cheapest validation — no I/O)
    if (!this.allowedMethods.has(input.method)) {
      return JSON.stringify({
        error: `Method ${input.method} is not allowed. Allowed methods: ${[...this.allowedMethods].join(", ")}`,
      })
    }

    // 2. Integration lookup
    const resolved = this.resolvedMap.get(input.integration)
    if (!resolved) {
      return JSON.stringify({
        error: `Unknown integration: ${input.integration}. Available: ${[...this.resolvedMap.keys()].join(", ")}`,
      })
    }

    try {
      const resolvedPath = substitutePath(input.path, input.pathParams)

      // 3. Path prefix check — after substitution, before buildUrl
      const pathPrefixes = this.allowedPaths.get(input.integration)
      if (pathPrefixes && pathPrefixes.length > 0) {
        const allowed = pathPrefixes.some((prefix) =>
          resolvedPath.startsWith(prefix),
        )
        if (!allowed) {
          return JSON.stringify({
            error: `Path "${resolvedPath}" is not allowed for integration "${input.integration}". ` +
              `Allowed prefixes: ${pathPrefixes.join(", ")}`,
          })
        }
      }

      // 4. Budget check — after validation, before network call
      if (this.maxRequests > 0 && this.requestCount >= this.maxRequests) {
        return JSON.stringify({
          error: `Request budget exhausted (${this.maxRequests} requests). No more API calls allowed.`,
        })
      }
      this.requestCount++

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
        if (bodyStr.length > this.limits.maxBodySize) {
          return JSON.stringify({
            error: `Request body too large: ${bodyStr.length} chars (max ${this.limits.maxBodySize})`,
          })
        }
        headers["Content-Type"] = "application/json"
      }

      const response = await fetch(url, {
        method: input.method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(this.limits.requestTimeoutMs),
      })

      const text = await response.text()

      // Truncate very large responses to keep context manageable
      const truncated = text.length > this.limits.maxResponseSize
        ? text.slice(0, this.limits.maxResponseSize) + "\n...[truncated]"
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
