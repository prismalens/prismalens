/**
 * Investigation graph — dual purpose: LangGraph Studio + InvestigationExecutor.
 *
 * - investigationGraph(): Studio entry point (uses env vars + StubDataProvider)
 * - buildInvestigationGraph(): Shared builder (used by both Studio and Executor)
 *
 * Topology:
 *   START → scout → analyst (deterministic) → supervisor → {gatherer, analyst, resolver, __end__}
 *   gatherer → supervisor, analyst → supervisor, resolver → supervisor (loop edges)
 */

import { StateGraph } from "@langchain/langgraph"
import { MemorySaver } from "@langchain/langgraph-checkpoint"
import { LocalShellBackend, FilesystemBackend, CompositeBackend } from "deepagents"
import type { BackendProtocol } from "deepagents"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { InvestigationStateAnnotation } from "./state.js"
import { createScoutNode } from "../agents/scout/index.js"
import { createGathererNode } from "../agents/gatherer/index.js"
import { createAnalystNode } from "../agents/analyst/index.js"
import { createResolverNode } from "../agents/resolver/index.js"
import { supervisorNode } from "../agents/supervisor/node.js"
import { StubDataProvider } from "../providers/data-provider.js"
import {
  buildIntegrationEnvVars,
  buildIntegrationsFromEnv,
} from "../providers/integration-registry.js"
import { getGraphConfig, getAgentBudget } from "../config/env.js"
import { isRetryableError } from "../llm/retry.js"
import { createHttpRequestTool } from "../tools/http-request.js"
import { createWebBrowseTool } from "../tools/web-browse.js"
import type { DataProvider } from "../providers/data-provider.js"
import type { IntegrationWithCredentials } from "../types/contexts.js"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Package-level skills directory */
const SKILLS_DIR = resolve(__dirname, "../../skills")

/**
 * Dependencies for building the investigation graph.
 */
export interface InvestigationGraphDeps {
  dataProvider: DataProvider
  integrations: IntegrationWithCredentials[]
  checkpointer?: BaseCheckpointSaver
  mcpTools?: StructuredToolInterface[]
  /** Pre-created workspace dir path. If provided, LocalShellBackend uses it. */
  workspaceDir?: string
  /** Optional SearchApi API key. When set, web_search tool is added to analyst + resolver. */
  searchApiKey?: string
}

/**
 * Build the investigation graph.
 *
 * Topology:
 *   START → scout → analyst → supervisor → {gatherer, analyst, resolver, __end__}
 *   All agents loop back to supervisor after execution.
 *
 * Backend setup:
 *   - Workspace backend (LocalShellBackend): provides execute, grep, read_file on workspace
 *   - Skills backend (FilesystemBackend): read-only access to SKILL.md files
 *   - CompositeBackend: routes /skills/ to skills backend, default to workspace
 */
export async function buildInvestigationGraph(deps: InvestigationGraphDeps) {
  const { checkpointer, integrations, mcpTools = [] } = deps
  const cfg = getGraphConfig()

  // Per-agent budgets (registry-driven, env-overridable)
  const gathererBudget = getAgentBudget("gatherer")
  const analystBudget = getAgentBudget("analyst")
  const resolverBudget = getAgentBudget("resolver")

  // Build per-agent http_request tools with appropriate method restrictions.
  // Each agent gets its own tool instance so budget counters are independent.
  const gathererHttpTool = createHttpRequestTool(integrations, {
    allowedMethods: ["GET", "POST"],
    maxRequests: gathererBudget.httpBudget,
  })
  const analystHttpTool = createHttpRequestTool(integrations, {
    allowedMethods: ["GET"],
    maxRequests: analystBudget.httpBudget,
  })
  const resolverHttpTool = createHttpRequestTool(integrations, {
    allowedMethods: ["GET"],
    maxRequests: resolverBudget.httpBudget,
  })

  // Web tools for analyst + resolver (research known issues, read documentation).
  // Separate instances per agent so budgets are independent.
  const analystWebTools: StructuredToolInterface[] = [createWebBrowseTool({ maxUses: analystBudget.webBudget })]
  const resolverWebTools: StructuredToolInterface[] = [createWebBrowseTool({ maxUses: resolverBudget.webBudget })]

  if (deps.searchApiKey) {
    const { SearchApi } = await import("@langchain/community/tools/searchapi")
    analystWebTools.push(new SearchApi(deps.searchApiKey, { engine: "google" }))
    resolverWebTools.push(new SearchApi(deps.searchApiKey, { engine: "google" }))
  }

  // Build backend stack
  const backend = await createBackend(integrations, deps.workspaceDir)

  // Skills paths for deepagents progressive disclosure
  const commonSkillsPath = "/skills/common/"
  const gathererSkillsPath = "/skills/gatherer/"
  const analystSkillsPath = "/skills/analyst/"
  const resolverSkillsPath = "/skills/resolver/"

  // Shared retry policy for LLM-driven nodes (supervisor, gatherer, analyst, resolver).
  // Applied per-node via addNode options — scout is deterministic (no retry needed).
  const retryPolicy = {
    maxAttempts: cfg.PRISMALENS_GRAPH_RETRY_MAX_ATTEMPTS,
    initialInterval: cfg.PRISMALENS_GRAPH_RETRY_INITIAL_INTERVAL_MS,
    backoffFactor: cfg.PRISMALENS_GRAPH_RETRY_BACKOFF_FACTOR,
    jitter: true,
    retryOn: isRetryableError,
  }

  // Assemble per-agent tool arrays:
  //   gatherer: http_request (read+write) + MCP tools — NO web tools
  //   analyst:  http_request (read-only) + web_browse + web_search + MCP tools
  //   resolver: http_request (read-only) + web_browse + web_search + MCP tools
  const graph = new StateGraph(InvestigationStateAnnotation)
    .addNode("scout", createScoutNode(deps.dataProvider))
    .addNode("supervisor", supervisorNode, {
      ends: ["gatherer", "analyst", "resolver", "__end__"],
      retryPolicy,
    })
    .addNode(
      "gatherer",
      createGathererNode({
        backend,
        tools: [gathererHttpTool, ...mcpTools],
        skills: [commonSkillsPath, gathererSkillsPath],
      }),
      { retryPolicy },
    )
    .addNode(
      "analyst",
      createAnalystNode({
        backend,
        tools: [analystHttpTool, ...analystWebTools, ...mcpTools],
        skills: [commonSkillsPath, analystSkillsPath],
      }),
      { retryPolicy },
    )
    .addNode(
      "resolver",
      createResolverNode({
        backend,
        tools: [resolverHttpTool, ...resolverWebTools, ...mcpTools],
        skills: [commonSkillsPath, resolverSkillsPath],
      }),
      { retryPolicy },
    )
    // START → scout → analyst (deterministic first pass, no supervisor)
    .addEdge("__start__", "scout")
    .addEdge("scout", "analyst")
    // All agents loop back to supervisor after execution
    .addEdge("analyst", "supervisor")
    .addEdge("gatherer", "supervisor")
    .addEdge("resolver", "supervisor")
    // supervisor routes via Command({ goto }) to gatherer/analyst/resolver/__end__

  return graph.compile({ checkpointer })
}

/**
 * Create the composite backend for agents.
 *
 * Workspace backend (default): LocalShellBackend rooted at workspaceDir.
 *   - Provides execute(), grep, read_file, write_file on workspace files
 *   - Env vars set for integration credentials (e.g., RENDER_API_KEY)
 *   - inheritEnv: false prevents host env leakage
 *
 * Skills backend (routed at /skills/): FilesystemBackend for SKILL.md files.
 *
 * SECURITY NOTE: Credential env vars (e.g., RENDER_API_KEY) are visible to
 * execute() calls. This is intentional — scripts need credentials to make API
 * calls. The LLM agent can read them via `execute("env")`. Mitigations:
 *   - Each investigation gets an isolated workspace (no cross-investigation leakage)
 *   - Credentials are never serialized to graph state or checkpoints
 *   - inheritEnv: false prevents host env leakage
 *   - PATH restricted to standard binary dirs only
 *
 * REQUIRED before production deployment:
 *   1. Docker-based sandbox with network policy (restrict outbound to known base URLs)
 *   2. Command allowlisting (git, grep, python3, node — no curl, wget, nc)
 */
async function createBackend(
  integrations: IntegrationWithCredentials[],
  workspaceDir?: string,
): Promise<BackendProtocol> {
  const credentialEnvVars = buildIntegrationEnvVars(integrations)

  // Workspace backend: execute scripts, read/write workspace files
  const workspaceBackend = await LocalShellBackend.create({
    rootDir: workspaceDir,
    inheritEnv: false,
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: workspaceDir ?? "/tmp",
      ...credentialEnvVars,
    },
  })

  // Skills backend: read-only SKILL.md files
  const skillsBackend = new FilesystemBackend({
    rootDir: SKILLS_DIR,
    virtualMode: true,
  })

  // Composite: /skills/ → skills backend, everything else → workspace
  return new CompositeBackend(workspaceBackend, {
    "/skills/": skillsBackend,
  })
}

/**
 * LangGraph Studio entry point.
 *
 * Uses env vars for LLM config and StubDataProvider for mock data.
 * Studio calls this function to get the graph instance.
 */
export async function investigationGraph() {
  const dataProvider = new StubDataProvider()
  const checkpointer = new MemorySaver()

  return buildInvestigationGraph({
    dataProvider,
    integrations: buildIntegrationsFromEnv(),
    mcpTools: [],
    checkpointer,
  })
}
