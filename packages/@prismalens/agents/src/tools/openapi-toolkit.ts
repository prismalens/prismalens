/**
 * OpenAPI Toolkit — spec discovery for LangChain TypeScript agents.
 *
 * Produces a single `{name}_routes` tool that lets agents discover and
 * navigate OpenAPI spec endpoints with minimal token usage. No HTTP calls —
 * pure spec navigation. Output in TOON format (~40% fewer tokens than JSON).
 *
 * Auth, HTTP calls, and budgets are the agent's responsibility. This toolkit
 * only does discovery.
 */

import { readFile } from "node:fs/promises"

import { BaseToolkit, StructuredTool, type StructuredToolInterface } from "@langchain/core/tools"
import type { OpenAPIV3 } from "openapi-types"
import { z } from "zod"

import { formatForLlm } from "./format-toon.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenApiToolkitOptions {
  /** Tool name prefix (default: "api") — "myapi" → "myapi_routes" */
  name?: string

  /** Spec source — exactly one required: */
  specUrl?: string
  specPath?: string
  specObj?: Record<string, unknown>

  /** Whitelist: only paths matching these globs are available */
  allowedPaths?: string[]

  /** Blacklist: exclude paths matching these globs */
  disallowedPaths?: string[]
}

export interface ToolEndpoint {
  method: string
  path: string
  operationId?: string
  summary?: string
  description?: string
  tags: string[]
  parameters: ToolParameter[]
  security?: SecurityRequirement[]
}

export interface ToolParameter {
  name: string
  in: "path" | "query" | "header"
  required: boolean
  description?: string
  type?: string
  enum?: string[]
  default?: unknown
}

export interface SecurityRequirement {
  scheme: string
  type: string
  details: string
  scopes?: string[]
}

// ─── Glob matching ────────────────────────────────────────────────────────────

/**
 * Convert a path glob pattern to a RegExp.
 * Supports: * (single segment), ** (any depth).
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]+")
    .replace(/<<GLOBSTAR>>/g, ".*")
  return new RegExp(`^${escaped}$`)
}

function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(path))
}

// ─── Spec traversal ──────────────────────────────────────────────────────────

const HTTP_METHODS: ReadonlyArray<string> = [
  "get", "post", "put", "patch", "delete", "head", "options", "trace",
]

function isRef(obj: unknown): obj is OpenAPIV3.ReferenceObject {
  return typeof obj === "object" && obj !== null && "$ref" in obj
}

function resolveParam(
  param: OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.ParameterObject | undefined {
  if (isRef(param)) return undefined // $ref resolution not supported — skip
  return param
}

/**
 * Extract human-readable security info from securitySchemes.
 */
export function extractSecurity(
  doc: OpenAPIV3.Document,
): { global: SecurityRequirement[]; schemes: Map<string, SecurityRequirement> } {
  const schemes = new Map<string, SecurityRequirement>()

  const securitySchemes = doc.components?.securitySchemes
  if (securitySchemes) {
    for (const [name, schemeOrRef] of Object.entries(securitySchemes)) {
      if (isRef(schemeOrRef)) continue
      const scheme = schemeOrRef as OpenAPIV3.SecuritySchemeObject
      const schemeType = scheme.type as string
      let details: string = `Unknown (${schemeType})`

      switch (scheme.type) {
        case "http":
          details = `${capitalize(scheme.scheme ?? "unknown")} token`
          break
        case "apiKey":
          details = `API key in ${scheme.in} ${scheme.name}`
          break
        case "oauth2":
          details = "OAuth2"
          break
        case "openIdConnect":
          details = "OpenID Connect"
          break
      }
      schemes.set(name, {
        scheme: name,
        type: schemeType,
        details: `${details} (${schemeType}${scheme.type === "http" ? `/${scheme.scheme}` : ""})`,
      })
    }
  }

  // Resolve global security
  const global: SecurityRequirement[] = []
  if (doc.security) {
    for (const req of doc.security) {
      for (const [schemeName, scopes] of Object.entries(req)) {
        const resolved = schemes.get(schemeName)
        if (resolved) {
          global.push({
            ...resolved,
            scopes: scopes.length > 0 ? scopes : undefined,
          })
        }
      }
    }
  }

  return { global, schemes }
}

function mergeParameters(
  pathParams: OpenAPIV3.ParameterObject[],
  operation: OpenAPIV3.OperationObject,
): ToolParameter[] {
  const opParams = (operation.parameters ?? [])
    .map(resolveParam)
    .filter((p): p is OpenAPIV3.ParameterObject => p !== undefined)

  const merged = new Map<string, OpenAPIV3.ParameterObject>()
  for (const p of pathParams) merged.set(`${p.in}:${p.name}`, p)
  for (const p of opParams) merged.set(`${p.in}:${p.name}`, p)

  return [...merged.values()]
    .filter((p) => p.in === "path" || p.in === "query" || p.in === "header")
    .map((p) => {
      const schema = p.schema && !isRef(p.schema) ? p.schema : undefined
      return {
        name: p.name,
        in: p.in as "path" | "query" | "header",
        required: p.required ?? false,
        description: p.description,
        type: schema?.type as string | undefined,
        enum: schema?.enum as string[] | undefined,
        default: schema?.default,
      }
    })
}

function resolveOperationSecurity(
  operation: OpenAPIV3.OperationObject,
  schemes: Map<string, SecurityRequirement>,
): SecurityRequirement[] | undefined {
  if (!operation.security) return undefined
  const result: SecurityRequirement[] = []
  for (const req of operation.security) {
    for (const [schemeName, scopes] of Object.entries(req)) {
      const resolved = schemes.get(schemeName)
      if (resolved) {
        result.push({
          ...resolved,
          scopes: scopes.length > 0 ? scopes : undefined,
        })
      }
    }
  }
  return result
}

/**
 * Extract all endpoints from an OpenAPI 3.x document.
 */
export function extractEndpoints(doc: OpenAPIV3.Document): {
  title: string
  serverUrl: string
  endpoints: ToolEndpoint[]
  globalSecurity: SecurityRequirement[]
} {
  const title = doc.info.title
  const serverUrl = doc.servers?.[0]?.url ?? ""
  const { global: globalSecurity, schemes } = extractSecurity(doc)
  const endpoints: ToolEndpoint[] = []

  const paths = doc.paths ?? {}
  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!pathItem || isRef(pathItem)) continue
    const pathObj = pathItem as OpenAPIV3.PathItemObject

    const pathParams = (pathObj.parameters ?? [])
      .map(resolveParam)
      .filter((p): p is OpenAPIV3.ParameterObject => p !== undefined)

    for (const method of HTTP_METHODS) {
      const operation = pathObj[method as keyof OpenAPIV3.PathItemObject] as
        | OpenAPIV3.OperationObject
        | undefined
      if (!operation) continue

      endpoints.push({
        method: method.toUpperCase(),
        path: pathTemplate,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags ?? [],
        parameters: mergeParameters(pathParams, operation),
        security: resolveOperationSecurity(operation, schemes),
      })
    }
  }

  return { title, serverUrl, endpoints, globalSecurity }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Output formatting ──────────────────────────────────────────────────────

function formatCompactListing(
  title: string,
  serverUrl: string,
  authDesc: string,
  endpoints: ToolEndpoint[],
): string {
  // Group by tag if spec has tags
  const hasTags = endpoints.some((e) => e.tags.length > 0)

  if (hasTags) {
    const byTag = new Map<string, ToolEndpoint[]>()
    for (const ep of endpoints) {
      const tag = ep.tags[0] ?? "other"
      byTag.set(tag, [...(byTag.get(tag) ?? []), ep])
    }

    const sections: string[] = []
    for (const [tag, eps] of byTag) {
      const rows = eps.map((e) => ({
        method: e.method,
        path: e.path,
        summary: e.summary ?? "",
      }))
      sections.push(`## ${tag}\n${formatForLlm(rows)}`)
    }

    return `title: ${title}\nserverUrl: ${serverUrl}\nauth: ${authDesc}\n\n${sections.join("\n\n")}`
  }

  const rows = endpoints.map((e) => ({
    method: e.method,
    path: e.path,
    summary: e.summary ?? "",
  }))
  return formatForLlm({
    title,
    serverUrl,
    auth: authDesc,
    endpoints: rows,
  })
}

function formatParameterInline(params: ToolParameter[]): string {
  return params
    .map((p) => {
      const parts = [p.name]
      if (!p.required) parts[0] = `${p.name}?`
      if (p.type) parts.push(`(${p.type}${p.enum ? `, enum:[${p.enum.join("|")}]` : ""}${p.default !== undefined ? `, default:${p.default}` : ""})`)
      return parts.join(" ")
    })
    .join(", ")
}

function formatFewResults(endpoints: ToolEndpoint[]): string {
  const rows = endpoints.map((e) => {
    const pathParams = e.parameters.filter((p) => p.in === "path")
    const queryParams = e.parameters.filter((p) => p.in === "query")
    return {
      method: e.method,
      path: e.path,
      summary: e.summary ?? "",
      pathParams: pathParams.length > 0 ? formatParameterInline(pathParams) : "",
      queryParams: queryParams.length > 0 ? formatParameterInline(queryParams) : "",
    }
  })
  return formatForLlm({ matchCount: endpoints.length, endpoints: rows })
}

function formatSingleResult(endpoint: ToolEndpoint): string {
  const pathParams = endpoint.parameters.filter((p) => p.in === "path")
  const queryParams = endpoint.parameters.filter((p) => p.in === "query")
  const headerParams = endpoint.parameters.filter((p) => p.in === "header")

  const result: Record<string, unknown> = {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? "",
  }

  if (endpoint.description) result.description = endpoint.description
  if (endpoint.operationId) result.operationId = endpoint.operationId

  if (endpoint.security && endpoint.security.length > 0) {
    result.security = endpoint.security.map((s) => s.details).join(", ")
  }

  if (pathParams.length > 0) {
    result.pathParameters = pathParams.map((p) => ({
      name: p.name,
      required: p.required,
      type: p.type ?? "",
      description: p.description ?? "",
    }))
  }

  if (queryParams.length > 0) {
    result.queryParameters = queryParams.map((p) => ({
      name: p.name,
      required: p.required,
      type: p.type ?? "",
      default: p.default ?? "",
      enum: p.enum ? p.enum.join("|") : "",
      description: p.description ?? "",
    }))
  }

  if (headerParams.length > 0) {
    result.headerParameters = headerParams.map((p) => ({
      name: p.name,
      required: p.required,
      type: p.type ?? "",
      description: p.description ?? "",
    }))
  }

  return formatForLlm(result)
}

// ─── Routes tool ─────────────────────────────────────────────────────────────

const RoutesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe("Search endpoints by keyword ('logs') or path glob ('/services/*/logs')"),
  path: z
    .string()
    .optional()
    .describe("Get full details for a specific endpoint path template"),
})

type RoutesInput = z.infer<typeof RoutesSchema>

class RoutesTool extends StructuredTool {
  name: string
  description: string
  schema = RoutesSchema

  private title: string
  private serverUrl: string
  private authDescription: string
  private endpoints: ToolEndpoint[]

  constructor(
    toolName: string,
    title: string,
    serverUrl: string,
    authDescription: string,
    endpoints: ToolEndpoint[],
  ) {
    super()
    this.name = toolName
    this.title = title
    this.serverUrl = serverUrl
    this.authDescription = authDescription
    this.endpoints = endpoints

    this.description =
      `Discover ${title} API endpoints (${serverUrl}). ${endpoints.length} endpoints available. ` +
      `Auth: ${authDescription}. ` +
      `Use filter to search by keyword or path pattern. Use path for full parameter details.`
  }

  private lookupPath(pathQuery: string): string {
    const match = this.endpoints.find((e) => e.path === pathQuery)
    if (match) return formatSingleResult(match)

    const partial = this.endpoints.filter((e) => e.path.includes(pathQuery))
    if (partial.length > 0) {
      return `No exact match for "${pathQuery}". Did you mean:\n${partial.map((e) => `  ${e.method} ${e.path}`).join("\n")}`
    }
    return `No endpoint found for path "${pathQuery}". Use filter to search.`
  }

  private filterEndpoints(filter: string): ToolEndpoint[] {
    const isGlob = filter.includes("*")
    if (isGlob) {
      const regex = globToRegex(filter)
      return this.endpoints.filter((e) => regex.test(e.path))
    }

    const term = filter.toLowerCase()
    return this.endpoints.filter((e) =>
      e.path.toLowerCase().includes(term) ||
      (e.summary?.toLowerCase().includes(term) ?? false) ||
      (e.operationId?.toLowerCase().includes(term) ?? false) ||
      e.tags.some((t) => t.toLowerCase().includes(term)),
    )
  }

  private formatAdaptive(endpoints: ToolEndpoint[]): string {
    if (endpoints.length === 1) return formatSingleResult(endpoints[0])
    if (endpoints.length <= 5) return formatFewResults(endpoints)
    return formatCompactListing(this.title, this.serverUrl, this.authDescription, endpoints)
  }

  async _call(input: RoutesInput): Promise<string> {
    if (input.path) return this.lookupPath(input.path)

    if (input.filter) {
      const filtered = this.filterEndpoints(input.filter)
      if (filtered.length === 0) {
        return `No endpoints match "${input.filter}". Try a broader search term or use path glob patterns (e.g., /services/*).`
      }
      return this.formatAdaptive(filtered)
    }

    return this.formatAdaptive(this.endpoints)
  }
}

// ─── Toolkit ─────────────────────────────────────────────────────────────────

async function loadSpec(options: OpenApiToolkitOptions): Promise<OpenAPIV3.Document> {
  const sources = [options.specUrl, options.specPath, options.specObj].filter(Boolean)
  if (sources.length === 0) {
    throw new Error("OpenApiToolkit: exactly one of specUrl, specPath, or specObj is required")
  }
  if (sources.length > 1) {
    throw new Error("OpenApiToolkit: only one of specUrl, specPath, or specObj may be provided")
  }

  if (options.specObj) {
    return options.specObj as unknown as OpenAPIV3.Document
  }

  if (options.specUrl) {
    const response = await fetch(options.specUrl, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      throw new Error(`OpenApiToolkit: failed to fetch spec from ${options.specUrl}: ${response.status}`)
    }
    return (await response.json()) as OpenAPIV3.Document
  }

  // specPath — guaranteed to exist by source count check above
  const specPath = options.specPath as string
  const raw = await readFile(specPath, "utf-8")
  try {
    return JSON.parse(raw) as OpenAPIV3.Document
  } catch {
    throw new Error(`OpenApiToolkit: failed to parse spec at ${specPath}: invalid JSON`)
  }
}

export class OpenApiToolkit extends BaseToolkit {
  tools: StructuredToolInterface[]

  private constructor(tools: StructuredToolInterface[]) {
    super()
    this.tools = tools
  }

  static async create(options: OpenApiToolkitOptions): Promise<OpenApiToolkit> {
    const doc = await loadSpec(options)
    const { title, serverUrl, endpoints, globalSecurity } = extractEndpoints(doc)

    // Apply path filters
    let filtered = endpoints
    const { allowedPaths, disallowedPaths } = options
    if (allowedPaths && allowedPaths.length > 0) {
      filtered = filtered.filter((e) => matchesAnyGlob(e.path, allowedPaths))
    }
    if (disallowedPaths && disallowedPaths.length > 0) {
      filtered = filtered.filter((e) => !matchesAnyGlob(e.path, disallowedPaths))
    }

    const prefix = options.name ?? "api"
    const authDescription =
      globalSecurity.length > 0
        ? globalSecurity.map((s) => s.details).join(", ")
        : "None specified"

    const routesTool = new RoutesTool(
      `${prefix}_routes`,
      title,
      serverUrl,
      authDescription,
      filtered,
    )

    return new OpenApiToolkit([routesTool])
  }
}
