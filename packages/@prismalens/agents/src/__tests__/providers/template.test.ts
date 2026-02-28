import { describe, it, expect } from "vitest"
import { resolveTemplate, resolveTemplateMap } from "../../providers/template.js"
import type { TemplateContext } from "../../providers/template.js"

const ctx: TemplateContext = {
  credentials: { apiKey: "rnd_key", accessToken: "oauth_tok", username: "admin" },
  config: { baseUrl: "https://custom.example.com", org: "acme" },
}

describe("resolveTemplate", () => {
  it("resolves a simple credentials reference", () => {
    expect(resolveTemplate("Bearer {{credentials.apiKey}}", ctx)).toBe("Bearer rnd_key")
  })

  it("resolves a simple config reference", () => {
    expect(resolveTemplate("{{config.baseUrl}}", ctx)).toBe("https://custom.example.com")
  })

  it("resolves fallback with | operator", () => {
    expect(
      resolveTemplate("{{credentials.apiKey|credentials.accessToken}}", ctx),
    ).toBe("rnd_key")
  })

  it("falls back to second alternative when first is missing", () => {
    const partial: TemplateContext = {
      credentials: { accessToken: "tok_123" },
      config: {},
    }
    expect(
      resolveTemplate("{{credentials.apiKey|credentials.accessToken}}", partial),
    ).toBe("tok_123")
  })

  it("returns empty string when no alternative resolves", () => {
    const empty: TemplateContext = { credentials: {}, config: {} }
    expect(resolveTemplate("{{credentials.missing}}", empty)).toBe("")
  })

  it("skips empty string values", () => {
    const partial: TemplateContext = {
      credentials: { apiKey: "", accessToken: "fallback" },
      config: {},
    }
    expect(
      resolveTemplate("{{credentials.apiKey|credentials.accessToken}}", partial),
    ).toBe("fallback")
  })

  it("handles multiple placeholders in one template", () => {
    expect(
      resolveTemplate("{{credentials.username}}:{{credentials.apiKey}}", ctx),
    ).toBe("admin:rnd_key")
  })

  it("returns string unchanged when no placeholders", () => {
    expect(resolveTemplate("literal string", ctx)).toBe("literal string")
  })

  it("handles malformed expressions gracefully", () => {
    expect(resolveTemplate("{{badformat}}", ctx)).toBe("")
  })

  it("ignores unrecognized source names", () => {
    expect(resolveTemplate("{{secrets.apiKey}}", ctx)).toBe("")
    expect(resolveTemplate("{{env.PATH}}", ctx)).toBe("")
  })
})

describe("resolveTemplateMap", () => {
  it("resolves all entries", () => {
    const templates = {
      RENDER_API_KEY: "{{credentials.apiKey}}",
      RENDER_BASE_URL: "{{config.baseUrl}}",
    }
    expect(resolveTemplateMap(templates, ctx)).toEqual({
      RENDER_API_KEY: "rnd_key",
      RENDER_BASE_URL: "https://custom.example.com",
    })
  })

  it("omits entries that resolve to empty", () => {
    const empty: TemplateContext = { credentials: {}, config: {} }
    const templates = {
      PRESENT: "static_value",
      MISSING: "{{credentials.nope}}",
    }
    // "PRESENT" is not a template, so it's kept as-is
    // Wait — "static_value" has no {{}} so resolveTemplate returns it unchanged
    // But resolveTemplateMap only includes if resolved is truthy
    expect(resolveTemplateMap(templates, empty)).toEqual({
      PRESENT: "static_value",
    })
  })

  it("keeps literal keys unchanged", () => {
    const templates = {
      MY_KEY: "{{credentials.apiKey}}",
    }
    expect(resolveTemplateMap(templates, ctx)).toEqual({
      MY_KEY: "rnd_key",
    })
  })
})
