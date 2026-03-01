import { describe, it, expect } from "vitest"
import {
  resolveIntegration,
  buildIntegrationEnvVars,
  buildIntegrationsFromEnv,
  computeAvailableDataSources,
  resolveGitAuth,
} from "../../providers/integration-registry.js"
import { getAdapter } from "../../providers/adapters/index.js"
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

describe("getAdapter", () => {
  it("has adapters for render, github, prometheus", () => {
    expect(getAdapter("render")).toBeDefined()
    expect(getAdapter("github")).toBeDefined()
    expect(getAdapter("prometheus")).toBeDefined()
  })

  it("returns undefined for unknown types", () => {
    expect(getAdapter("unknown")).toBeUndefined()
  })

  it("each adapter has required fields", () => {
    for (const type of ["render", "github", "prometheus"]) {
      const adapter = getAdapter(type)!
      expect(adapter.type).toBe(type)
      expect(adapter.defaultBaseUrl).toBeTruthy()
      expect(adapter.dataSources.length).toBeGreaterThan(0)
      expect(adapter.authenticate).toBeDefined()
      expect(adapter.envVars).toBeDefined()
    }
  })
})

describe("resolveIntegration", () => {
  it("resolves render with apiKey → Bearer header", () => {
    const result = resolveIntegration(makeIntegration())

    expect(result).not.toBeNull()
    expect(result!.type).toBe("render")
    expect(result!.baseUrl).toBe("https://api.render.com")
    expect(result!.authHeaders.Authorization).toBe("Bearer rnd_test_key")
  })

  it("resolves github with accessToken via fallback", () => {
    const result = resolveIntegration(
      makeIntegration({
        type: "github",
        credentials: { accessToken: "oauth_token" },
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.authHeaders.Authorization).toBe("Bearer oauth_token")
  })

  it("prefers apiKey over accessToken for github (first fallback wins)", () => {
    const result = resolveIntegration(
      makeIntegration({
        type: "github",
        credentials: { apiKey: "api_key", accessToken: "oauth_token" },
      }),
    )

    expect(result!.authHeaders.Authorization).toBe("Bearer api_key")
  })

  it("resolves prometheus with basic auth", () => {
    const result = resolveIntegration(
      makeIntegration({
        type: "prometheus",
        credentials: { username: "admin", apiKey: "prom_secret" },
      }),
    )

    expect(result).not.toBeNull()
    const expected = `Basic ${Buffer.from("admin:prom_secret").toString("base64")}`
    expect(result!.authHeaders.Authorization).toBe(expected)
  })

  it("resolves prometheus with password only (no username)", () => {
    const result = resolveIntegration(
      makeIntegration({
        type: "prometheus",
        credentials: { apiKey: "prom_secret" },
      }),
    )

    expect(result).not.toBeNull()
    const expected = `Basic ${Buffer.from(":prom_secret").toString("base64")}`
    expect(result!.authHeaders.Authorization).toBe(expected)
  })

  it("uses custom baseUrl from config", () => {
    const result = resolveIntegration(
      makeIntegration({
        config: { baseUrl: "https://custom.render.com" },
      }),
    )

    expect(result!.baseUrl).toBe("https://custom.render.com")
  })

  it("falls back to default baseUrl", () => {
    const result = resolveIntegration(makeIntegration({ config: {} }))
    expect(result!.baseUrl).toBe("https://api.render.com")
  })

  it("returns null for unknown integration type", () => {
    const result = resolveIntegration(
      makeIntegration({ type: "unknown" }),
    )
    expect(result).toBeNull()
  })

  it("returns null for missing credentials", () => {
    const result = resolveIntegration(
      makeIntegration({ credentials: {} }),
    )
    expect(result).toBeNull()
  })
})

describe("buildIntegrationEnvVars", () => {
  it("builds env vars from render adapter templates", () => {
    const env = buildIntegrationEnvVars([makeIntegration()])

    expect(env.RENDER_API_KEY).toBe("rnd_test_key")
    expect(env.RENDER_BASE_URL).toBe("https://api.render.com")
  })

  it("builds env vars for github (uses GITHUB_TOKEN, not GITHUB_API_KEY)", () => {
    const env = buildIntegrationEnvVars([
      makeIntegration({
        type: "github",
        credentials: { apiKey: "ghp_test" },
      }),
    ])

    expect(env.GITHUB_TOKEN).toBe("ghp_test")
    expect(env.GITHUB_BASE_URL).toBe("https://api.github.com")
  })

  it("builds env vars for multiple integrations", () => {
    const env = buildIntegrationEnvVars([
      makeIntegration(),
      makeIntegration({
        id: "conn-2",
        type: "github",
        credentials: { apiKey: "ghp_test" },
      }),
    ])

    expect(env.RENDER_API_KEY).toBe("rnd_test_key")
    expect(env.GITHUB_TOKEN).toBe("ghp_test")
  })

  it("skips integrations with unknown type", () => {
    const env = buildIntegrationEnvVars([
      makeIntegration({ type: "unknown" }),
    ])

    expect(Object.keys(env)).toHaveLength(0)
  })

  it("uses custom baseUrl from config", () => {
    const env = buildIntegrationEnvVars([
      makeIntegration({ config: { baseUrl: "https://custom.render.com" } }),
    ])

    expect(env.RENDER_BASE_URL).toBe("https://custom.render.com")
  })

  it("prometheus only exports base URL (no credential env vars)", () => {
    const env = buildIntegrationEnvVars([
      makeIntegration({
        type: "prometheus",
        config: { baseUrl: "http://prom:9090" },
        credentials: { apiKey: "secret" },
      }),
    ])

    expect(env.PROMETHEUS_BASE_URL).toBe("http://prom:9090")
    // Prometheus adapter doesn't have credential env vars in its envVars config
    expect(env.PROMETHEUS_API_KEY).toBeUndefined()
  })
})

describe("computeAvailableDataSources", () => {
  it("returns data sources for enabled integrations", () => {
    const sources = computeAvailableDataSources([
      { type: "render", enabled: true },
    ])

    expect(sources).toHaveLength(2)
    expect(sources.map((s) => s.source)).toContain("logs")
    expect(sources.map((s) => s.source)).toContain("deployments")
  })

  it("skips disabled integrations", () => {
    const sources = computeAvailableDataSources([
      { type: "render", enabled: false },
    ])

    expect(sources).toHaveLength(0)
  })

  it("skips unknown integration types", () => {
    const sources = computeAvailableDataSources([
      { type: "unknown", enabled: true },
    ])

    expect(sources).toHaveLength(0)
  })

  it("combines data sources from multiple integrations", () => {
    const sources = computeAvailableDataSources([
      { type: "render", enabled: true },
      { type: "github", enabled: true },
    ])

    expect(sources.length).toBeGreaterThanOrEqual(4)
    const sourceNames = sources.map((s) => s.source)
    expect(sourceNames).toContain("logs")
    expect(sourceNames).toContain("code")
    expect(sourceNames).toContain("commits")
  })

  it("includes provider name in each source", () => {
    const sources = computeAvailableDataSources([
      { type: "render", enabled: true },
    ])

    for (const source of sources) {
      expect(source.provider).toBe("render")
    }
  })
})

describe("resolveGitAuth", () => {
  it("resolves github clone URL with apiKey", () => {
    const url = resolveGitAuth(
      makeIntegration({
        type: "github",
        credentials: { apiKey: "ghp_token" },
      }),
    )

    expect(url).toBe("https://x-access-token:ghp_token@github.com")
  })

  it("resolves github clone URL with accessToken fallback", () => {
    const url = resolveGitAuth(
      makeIntegration({
        type: "github",
        credentials: { accessToken: "gho_token" },
      }),
    )

    expect(url).toBe("https://x-access-token:gho_token@github.com")
  })

  it("returns null for integrations without gitAuth", () => {
    const url = resolveGitAuth(makeIntegration({ type: "render" }))
    expect(url).toBeNull()
  })

  it("returns null for unknown integration types", () => {
    const url = resolveGitAuth(makeIntegration({ type: "unknown" }))
    expect(url).toBeNull()
  })
})

describe("buildIntegrationsFromEnv", () => {
  it("returns empty array when no env vars set", () => {
    const result = buildIntegrationsFromEnv({})
    expect(result).toEqual([])
  })

  it("creates Render integration from RENDER_API_KEY", () => {
    const result = buildIntegrationsFromEnv({ RENDER_API_KEY: "rnd_test" })

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("render")
    expect(result[0].credentials).toEqual({ apiKey: "rnd_test" })
    expect(result[0].enabled).toBe(true)
  })

  it("creates GitHub integration from GITHUB_TOKEN", () => {
    const result = buildIntegrationsFromEnv({ GITHUB_TOKEN: "ghp_test" })

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("github")
    expect(result[0].credentials).toEqual({ apiKey: "ghp_test" })
  })

  it("creates Prometheus integration with both credentials", () => {
    const result = buildIntegrationsFromEnv({
      PROMETHEUS_USERNAME: "admin",
      PROMETHEUS_PASSWORD: "secret",
    })

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("prometheus")
    expect(result[0].credentials).toEqual({ username: "admin", apiKey: "secret" })
  })

  it("creates all integrations when all env vars set", () => {
    const result = buildIntegrationsFromEnv({
      RENDER_API_KEY: "rnd_test",
      GITHUB_TOKEN: "ghp_test",
      PROMETHEUS_USERNAME: "admin",
      PROMETHEUS_PASSWORD: "secret",
    })

    expect(result).toHaveLength(3)
    const types = result.map((i) => i.type)
    expect(types).toContain("render")
    expect(types).toContain("github")
    expect(types).toContain("prometheus")
  })

  it("uses default baseUrl when env var not set", () => {
    const result = buildIntegrationsFromEnv({ RENDER_API_KEY: "rnd_test" })

    expect(result[0].config.baseUrl).toBe("https://api.render.com")
  })

  it("uses custom baseUrl from env over default", () => {
    const result = buildIntegrationsFromEnv({
      RENDER_API_KEY: "rnd_test",
      RENDER_BASE_URL: "https://custom.render.com",
    })

    expect(result[0].config.baseUrl).toBe("https://custom.render.com")
  })

  it("creates integration with partial Prometheus credentials", () => {
    const result = buildIntegrationsFromEnv({ PROMETHEUS_USERNAME: "admin" })

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("prometheus")
    expect(result[0].credentials).toEqual({ username: "admin" })
  })

  it("sets correct id and name format", () => {
    const result = buildIntegrationsFromEnv({ RENDER_API_KEY: "rnd_test" })

    expect(result[0].id).toBe("standalone-render")
    expect(result[0].name).toBe("render (env)")
  })
})
