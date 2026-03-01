/**
 * Shared deps interface for all agent node factories.
 *
 * Aligned with createDeepAgent's params — tools and skills are flat arrays.
 * The graph builder assembles per-agent tool sets; factories just pass through.
 */

import type { BackendProtocol } from "deepagents"
import type { StructuredToolInterface } from "@langchain/core/tools"

/**
 * Shared dependencies for all agent node factories.
 *
 * The graph builder decides which tools each agent gets. Agent factories
 * receive a flat tools array and pass it directly to createDeepAgent.
 */
export interface AgentNodeDeps {
  backend: BackendProtocol
  tools: StructuredToolInterface[]
  skills: string[]
}
