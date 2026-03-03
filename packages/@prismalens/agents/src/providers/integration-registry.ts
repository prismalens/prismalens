/**
 * Declarative integration adapter registry.
 *
 * Each integration is defined as pure data (IntegrationAdapter) — no functions.
 * Auth injection uses a template engine that resolves {{credentials.field}}
 * and {{config.field}} at runtime.
 *
 * Adding a new integration:
 * 1. Create adapter in providers/adapters/
 * 2. Register in adapters/index.ts
 * 3. Add OpenAPI spec to specs/
 * 4. Create SKILL.md in skills/gatherer/
 * 5. Seed IntegrationDefinition + credentialSchema in DB
 */

import type { IntegrationWithCredentials } from "../types/contexts.js"
import type { AvailableDataSource, DataRequest } from "../types/state.js"
import { resolveTemplate, resolveTemplateMap } from "./template.js"
import type { TemplateContext } from "./template.js"
import { getAdapter, getAllAdapters } from "./adapters/index.js"

// ============================================================================
// Adapter Interface — pure data, no functions
// ============================================================================

/**
 * Declarative integration adapter — pure data, no functions.
 * Templates: {{credentials.field}}, {{config.field}}
 * Fallback: {{credentials.apiKey|credentials.accessToken}}
 */
export interface IntegrationAdapter {
  readonly type: string
  readonly defaultBaseUrl: string
  readonly dataSources: DataRequest["source"][]

  /** Declarative auth injection — templates resolved at runtime */
  readonly authenticate: AuthenticateConfig

  /** Declarative env var mapping — keys are env var names, values are templates */
  readonly envVars: Record<string, string>

  /** Health check endpoint for credential validation */
  readonly testRequest?: TestRequest

  /** Git clone auth — only for code_source integrations */
  readonly gitAuth?: GitAuthConfig

  /**
   * Declarative env var → credential/config mapping for standalone usage.
   * Enables `buildIntegrationsFromEnv()` to construct IntegrationWithCredentials
   * from environment variables (Studio, evals, CLI) without DB access.
   */
  readonly fromEnv?: {
    credentials: Record<string, string>  // { fieldName: "ENV_VAR_NAME" }
    config?: Record<string, string>      // { fieldName: "ENV_VAR_NAME" }
  }
}

/**
 * Declarative auth config — header, basic, and query auth patterns.
 */
export interface AuthenticateConfig {
  /** Headers to inject — template values. Multiple headers supported (Datadog). */
  headers?: Record<string, string>
  /** Basic auth — templates resolved, then base64-encoded as Authorization: Basic <encoded> */
  basic?: { username: string; password: string }
  /** Query parameters to inject — template values */
  query?: Record<string, string>
}

export interface GitAuthConfig {
  cloneUrlTemplate: string
}

export interface TestRequest {
  path: string
  method?: string
}

// ============================================================================
// Resolved Integration — runtime output
// ============================================================================

/**
 * Fully resolved integration ready for http_request tool usage.
 * Built at graph construction time from DB credentials + adapter config.
 */
export interface ResolvedIntegration {
  type: string
  connectionId: string
  baseUrl: string
  /** Multiple auth headers (supports Datadog-style multi-header auth) */
  authHeaders: Record<string, string>
  config: Record<string, unknown>
}

// ============================================================================
// Auth Resolution
// ============================================================================

/**
 * Resolve an adapter's declarative auth config into concrete headers.
 * Returns null if no auth could be resolved.
 */
function resolveAdapterAuth(
  adapter: IntegrationAdapter,
  credentials: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, string> | null {
  const ctx: TemplateContext = { credentials, config }
  const headers: Record<string, string> = {}

  // Header-based auth (bearer, API keys, custom headers)
  if (adapter.authenticate.headers) {
    Object.assign(headers, resolveTemplateMap(adapter.authenticate.headers, ctx))
  }

  // Basic auth (Jira, Prometheus) — base64 encoded
  if (adapter.authenticate.basic) {
    const username = resolveTemplate(adapter.authenticate.basic.username, ctx)
    const password = resolveTemplate(adapter.authenticate.basic.password, ctx)
    if (username || password) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
    }
  }

  if (Object.keys(headers).length === 0) return null
  return headers
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve an integration's runtime credentials + config into a form
 * usable by the http_request tool.
 */
export function resolveIntegration(
  integration: IntegrationWithCredentials,
): ResolvedIntegration | null {
  const adapter = getAdapter(integration.type)
  if (!adapter) return null

  const baseUrl =
    (integration.config.baseUrl as string | undefined) ??
    adapter.defaultBaseUrl

  const authHeaders = resolveAdapterAuth(
    adapter,
    integration.credentials,
    integration.config,
  )
  if (!authHeaders) return null

  return {
    type: integration.type,
    connectionId: integration.id,
    baseUrl,
    authHeaders,
    config: integration.config,
  }
}

/**
 * Build env var map from integrations for workspace execute scripts.
 * Uses adapter.envVars templates resolved against credentials + config.
 */
export function buildIntegrationEnvVars(
  integrations: IntegrationWithCredentials[],
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const integration of integrations) {
    const adapter = getAdapter(integration.type)
    if (!adapter) continue

    const ctx: TemplateContext = {
      credentials: integration.credentials,
      config: {
        ...integration.config,
        baseUrl:
          (integration.config.baseUrl as string | undefined) ??
          adapter.defaultBaseUrl,
      },
    }

    Object.assign(env, resolveTemplateMap(adapter.envVars, ctx))
  }

  return env
}

/**
 * Compute available data sources from enabled integrations.
 */
export function computeAvailableDataSources(
  integrations: Array<{ type: string; enabled: boolean }>,
): AvailableDataSource[] {
  const sources: AvailableDataSource[] = []

  for (const integration of integrations) {
    if (!integration.enabled) continue

    const adapter = getAdapter(integration.type)
    if (!adapter) continue

    for (const source of adapter.dataSources) {
      sources.push({
        source,
        provider: integration.type,
        description: `${source} from ${integration.type}`,
      })
    }
  }

  return sources
}

/**
 * Resolve git clone URL for a code_source integration.
 */
export function resolveGitAuth(
  integration: IntegrationWithCredentials,
): string | null {
  const adapter = getAdapter(integration.type)
  if (!adapter?.gitAuth) return null

  const ctx: TemplateContext = {
    credentials: integration.credentials,
    config: integration.config,
  }

  const resolved = resolveTemplate(adapter.gitAuth.cloneUrlTemplate, ctx)
  return resolved || null
}

/**
 * Build IntegrationWithCredentials[] from environment variables.
 *
 * Iterates all registered adapters, reads env vars per adapter.fromEnv,
 * and constructs integrations for adapters that have at least one credential present.
 * Used by Studio and evals to get integrations without DB access.
 */
export function buildIntegrationsFromEnv(
  env: Record<string, string | undefined> = process.env,
): IntegrationWithCredentials[] {
  const integrations: IntegrationWithCredentials[] = []

  for (const adapter of getAllAdapters()) {
    if (!adapter.fromEnv) continue

    // Read credentials from env — skip adapter if no credentials found
    const credentials: Record<string, unknown> = {}
    let hasCredential = false

    for (const [field, envVar] of Object.entries(adapter.fromEnv.credentials)) {
      const value = env[envVar]
      if (value) {
        credentials[field] = value
        hasCredential = true
      }
    }

    if (!hasCredential) continue

    // Read optional config from env
    const config: Record<string, unknown> = {}
    if (adapter.fromEnv.config) {
      for (const [field, envVar] of Object.entries(adapter.fromEnv.config)) {
        const value = env[envVar]
        if (value) {
          config[field] = value
        }
      }
    }

    // Use adapter default base URL if not provided via env
    if (!config.baseUrl) {
      config.baseUrl = adapter.defaultBaseUrl
    }

    integrations.push({
      id: `standalone-${adapter.type}`,
      name: `${adapter.type} (env)`,
      type: adapter.type,
      enabled: true,
      config,
      credentials,
    })
  }

  return integrations
}
