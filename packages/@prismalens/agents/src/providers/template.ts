/**
 * Template engine for declarative integration adapters.
 *
 * Resolves {{credentials.field}} and {{config.field}} placeholders.
 * Supports | fallback operator: {{credentials.apiKey|credentials.accessToken}}
 */

export interface TemplateContext {
  credentials: Record<string, unknown>
  config: Record<string, unknown>
}

/**
 * Resolve a single template string against credentials + config context.
 * Returns empty string if no value found.
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  let hasUnresolved = false
  const result = template.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    const alternatives = expr.split("|").map((s) => s.trim())
    for (const alt of alternatives) {
      const [source, field] = alt.split(".")
      if (!source || !field) continue
      const map =
        source === "credentials" ? ctx.credentials :
        source === "config" ? ctx.config :
        undefined
      if (!map) continue
      const value = map?.[field]
      if (value !== undefined && value !== null && value !== "") {
        return String(value)
      }
    }
    hasUnresolved = true
    return ""
  })
  // If any placeholder was unresolved, return empty to signal failure
  if (hasUnresolved) return ""
  return result
}

/**
 * Resolve a map of template strings. Skips entries that resolve to empty.
 */
export function resolveTemplateMap(
  templates: Record<string, string>,
  ctx: TemplateContext,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, template] of Object.entries(templates)) {
    const resolved = resolveTemplate(template, ctx)
    if (resolved) {
      result[key] = resolved
    }
  }
  return result
}
