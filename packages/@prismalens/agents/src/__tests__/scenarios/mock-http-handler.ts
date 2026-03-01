/**
 * MockHttpHandler — intercepts fetch() for scenario testing.
 *
 * Overrides globalThis.fetch to intercept at the fetch level, ensuring
 * the full HttpRequestTool._call pipeline runs (URL construction, SSRF
 * prevention, auth injection, method validation, response truncation).
 *
 * Works in both vitest tests and eval contexts (no vitest dependency).
 */

import type { MockHttpRoute } from "./types.js"

/** Recorded call for post-test assertions */
export interface HttpCall {
  integration: string
  path: string
  method: string
  url: string
}

/**
 * Known base URL → integration type mapping.
 * Used to detect which integration a fetch() call belongs to.
 */
const DOMAIN_TO_INTEGRATION: Record<string, string> = {
  "api.github.com": "github",
  "api.render.com": "render",
}

export class MockHttpHandler {
  private readonly routes: MockHttpRoute[]
  private readonly calls: HttpCall[] = []
  private originalFetch: typeof globalThis.fetch | null = null

  constructor(routes: MockHttpRoute[]) {
    this.routes = routes
  }

  /**
   * Install the mock — replaces globalThis.fetch.
   */
  install(): void {
    this.originalFetch = globalThis.fetch
    this.calls.length = 0
    globalThis.fetch = this.handleFetch.bind(this) as typeof fetch
  }

  /**
   * Restore the original fetch.
   */
  restore(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch
      this.originalFetch = null
    }
  }

  /**
   * Get all recorded calls for assertions.
   */
  getCalls(): readonly HttpCall[] {
    return this.calls
  }

  /**
   * Handle a fetch() call — match against routes and return mock response.
   */
  private async handleFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? "GET"

    const parsedUrl = new URL(url)
    const integration = this.detectIntegration(parsedUrl)

    // Pass through requests to unknown domains (LangSmith, LLM APIs, etc.)
    if (integration === "unknown" && this.originalFetch) {
      return this.originalFetch(input, init)
    }

    const path = parsedUrl.pathname

    this.calls.push({ integration, path, method, url })

    // Find matching route
    const route = this.findRoute(integration, path, parsedUrl.searchParams)

    if (!route) {
      const registeredRoutes = this.routes
        .map((r) => `  ${r.integration}: ${String(r.pathPattern)}`)
        .join("\n")

      return new Response(
        JSON.stringify({
          error: `MockHttpHandler: No route matched for ${method} ${url}`,
          registeredRoutes: registeredRoutes,
        }),
        { status: 404, statusText: "Not Found" },
      )
    }

    const status = route.status ?? 200
    const body =
      typeof route.responseBody === "string"
        ? route.responseBody
        : JSON.stringify(route.responseBody)

    return new Response(body, {
      status,
      statusText: status === 200 ? "OK" : `Error ${status}`,
    })
  }

  /**
   * Detect integration type from URL domain.
   */
  private detectIntegration(url: URL): string {
    return DOMAIN_TO_INTEGRATION[url.hostname] ?? "unknown"
  }

  /**
   * Find the first matching route for a request.
   */
  private findRoute(
    integration: string,
    path: string,
    searchParams: URLSearchParams,
  ): MockHttpRoute | undefined {
    return this.routes.find((route) => {
      // Integration type must match
      if (route.integration !== integration) return false

      // Path pattern matching
      if (typeof route.pathPattern === "string") {
        if (!path.startsWith(route.pathPattern)) return false
      } else {
        if (!route.pathPattern.test(path)) return false
      }

      // Optional query param matching
      if (route.queryMatch) {
        for (const [key, value] of Object.entries(route.queryMatch)) {
          if (searchParams.get(key) !== value) return false
        }
      }

      return true
    })
  }
}
