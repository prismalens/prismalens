/**
 * Adapter registry — maps integration type names to declarative adapters.
 */

import type { IntegrationAdapter } from "../integration-registry.js"
import { renderAdapter } from "./render.js"
import { githubAdapter } from "./github.js"
import { prometheusAdapter } from "./prometheus.js"

const ADAPTERS = new Map<string, IntegrationAdapter>([
  [renderAdapter.type, renderAdapter],
  [githubAdapter.type, githubAdapter],
  [prometheusAdapter.type, prometheusAdapter],
])

/**
 * Get the adapter for an integration type.
 * Returns undefined for unknown types.
 */
export function getAdapter(type: string): IntegrationAdapter | undefined {
  return ADAPTERS.get(type)
}

/**
 * Get all registered adapters.
 * Used by buildIntegrationsFromEnv to iterate all adapters.
 */
export function getAllAdapters(): IntegrationAdapter[] {
  return [...ADAPTERS.values()]
}
