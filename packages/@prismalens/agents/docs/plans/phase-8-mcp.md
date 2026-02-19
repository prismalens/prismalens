# Phase 8: MCP Integration

**Status**: PLANNED
**Dependencies**: Phase 5 (supervisor + streaming working), Phase 4 (gatherer accepts tool arrays)
**Estimated effort**: 2-3 days

## Goal

Enable users to extend investigations with custom tools via MCP (Model Context Protocol) servers. MCP tools are discovered at executor construction time and passed to the gatherer agent alongside skill-based tools.

## Grounding Notes (DB Schema & API Truth)

| Claim | Actual Truth Source | Status |
|-------|---------------------|--------|
| MCPServer DB model exists | **NO MCP models** in DB schema | Must decide: add schema or config-file-only |
| @langchain/mcp-adapters installed | **NOT installed** — must add to package.json | Must add |
| MCPClientManager stub exists | Yes — `agents/src/tools/mcp/client.ts` has stub class | Confirmed |
| MCP converter stub exists | Yes — `agents/src/tools/mcp/converter.ts` has `mcpToolsToLangChain()` -> [] | Confirmed |
| Frontend MCP settings page | **Does not exist** | Must create |
| IntegrationDefinition extensible | `IntegrationDefinition.category` is a String field — can add `"mcp"` | Design option |
| IntegrationConnection for MCP | Can reuse `IntegrationConnection` (credentials + config JSON) instead of new model | Preferred approach |

## Architecture Decision: No New DB Model

Reuse existing `IntegrationDefinition` + `IntegrationConnection` instead of creating a new MCPServer model:

- **IntegrationDefinition**: Seed one with `category: "mcp"`, `authType: "api_key"`
- **IntegrationConnection**: Each MCP server is a connection with:
  - `config: { transport: { type: "sse" | "streamable-http", url: "..." }, serverName: "..." }`
  - `credentials`: Optional (encrypted via AES-256-GCM like all other integrations)

**Plus**: Support `~/.prismalens/mcp-servers.json` config file for power users who prefer file-based config.

## Step 1: Implement MCPClientManager

**Modify**: `agents/src/tools/mcp/client.ts`

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters"
import type { StructuredToolInterface } from "@langchain/core/tools"

export interface MCPServerConfig {
  name: string
  transport: {
    type: "sse" | "streamable-http" | "stdio"
    url?: string
    command?: string
    args?: string[]
  }
  headers?: Record<string, string>
  timeout?: number  // default: 30_000ms
}

export class MCPClientManager {
  private client: MultiServerMCPClient | null = null
  private connected = false

  async connect(servers: MCPServerConfig[]): Promise<void> {
    if (servers.length === 0) return

    const serverConfig = servers.reduce(
      (acc, s) => ({
        ...acc,
        [s.name]: {
          transport: s.transport.type,
          url: s.transport.url,
          command: s.transport.command,
          args: s.transport.args,
          headers: s.headers,
        },
      }),
      {} as Record<string, unknown>,
    )

    this.client = new MultiServerMCPClient(serverConfig)
    await this.client.connect()
    this.connected = true
  }

  async getTools(): Promise<StructuredToolInterface[]> {
    if (!this.connected || !this.client) return []
    return this.client.getTools()
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.connected = false
    }
  }

  isConnected(): boolean {
    return this.connected
  }
}
```

### Key Design Notes

- `@langchain/mcp-adapters` provides `MultiServerMCPClient` which handles MCP protocol negotiation and tool conversion to LangChain `StructuredToolInterface`
- The converter stub (`mcp/converter.ts`) may be unnecessary if `mcp-adapters` handles JSON Schema -> Zod conversion internally. Keep it as an escape hatch for custom tool wrapping.

## Step 2: Implement MCP Tool Converter (If Needed)

**Modify**: `agents/src/tools/mcp/converter.ts`

If `@langchain/mcp-adapters` handles conversion fully, this becomes a thin wrapper for safety:

```typescript
import type { StructuredToolInterface } from "@langchain/core/tools"

export interface MCPToolSafetyOptions {
  timeoutMs: number           // default: 30_000
  maxCallsPerInvestigation: number  // default: 10
  onError: "throw" | "return_error"  // default: "return_error"
}

export function wrapMcpToolsWithSafety(
  tools: StructuredToolInterface[],
  options: MCPToolSafetyOptions = { timeoutMs: 30_000, maxCallsPerInvestigation: 10, onError: "return_error" },
): StructuredToolInterface[] {
  let callCount = 0

  return tools.map(originalTool => ({
    ...originalTool,
    invoke: async (input: unknown, config?: unknown) => {
      // Rate limiting
      if (callCount >= options.maxCallsPerInvestigation) {
        return JSON.stringify({ error: `MCP tool call limit reached (${options.maxCallsPerInvestigation})` })
      }
      callCount++

      // Timeout
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.timeoutMs)

      try {
        return await originalTool.invoke(input, { ...config, signal: controller.signal })
      } catch (error) {
        if (options.onError === "throw") throw error
        return JSON.stringify({ error: `MCP tool ${originalTool.name} failed: ${(error as Error).message}` })
      } finally {
        clearTimeout(timer)
      }
    },
  }))
}
```

## Step 3: MCP Server Configuration

**Create**: `agents/src/tools/mcp/config.ts`

Merge both DB-based and file-based MCP server configurations:

```typescript
import type { IntegrationContext } from "../../types/contexts.js"
import type { MCPServerConfig } from "./client.js"

/**
 * Resolve MCP server configs from two sources:
 * 1. IntegrationConnection records with category "mcp" (from DB)
 * 2. Config file: ~/.prismalens/mcp-servers.json (for power users)
 */
export async function resolveMcpServers(
  integrations: IntegrationContext[],
  configFilePath?: string,
): Promise<MCPServerConfig[]> {
  const servers: MCPServerConfig[] = []

  // Source 1: DB integrations with category "mcp"
  const mcpIntegrations = integrations.filter(i => i.type === "mcp")
  for (const integration of mcpIntegrations) {
    const config = integration.config as {
      transport?: { type: string; url?: string }
      serverName?: string
    }
    if (config.transport) {
      servers.push({
        name: config.serverName ?? integration.name,
        transport: config.transport as MCPServerConfig["transport"],
      })
    }
  }

  // Source 2: Config file (optional)
  if (configFilePath) {
    try {
      const fs = await import("node:fs/promises")
      const content = await fs.readFile(configFilePath, "utf-8")
      const fileConfig = JSON.parse(content) as { servers?: MCPServerConfig[] }
      if (fileConfig.servers) {
        servers.push(...fileConfig.servers)
      }
    } catch {
      // Config file is optional — skip if missing or invalid
    }
  }

  return servers
}
```

### Config File Format

`~/.prismalens/mcp-servers.json`:
```json
{
  "servers": [
    {
      "name": "custom-tool-server",
      "transport": {
        "type": "sse",
        "url": "http://localhost:8080/sse"
      }
    },
    {
      "name": "file-system-tools",
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["@modelcontextprotocol/server-filesystem", "/data"]
      }
    }
  ]
}
```

## Step 4: Wire MCP Tools into Executor + Gatherer

**Modify**: `agents/src/executor/investigation-executor.ts`

```typescript
export class InvestigationExecutor {
  private graph: ReturnType<typeof buildInvestigationGraph>
  private mcpClient: MCPClientManager

  constructor(deps: InvestigationExecutorDeps = {}) {
    this.mcpClient = new MCPClientManager()

    const graphDeps: InvestigationGraphDeps = {
      dataProvider: deps.dataProvider ?? new StubDataProvider(),
      integrations: deps.integrations ?? [],
      checkpointer: deps.checkpointer,
      mcpTools: [],  // Populated after connect()
    }

    this.graph = buildInvestigationGraph(graphDeps)
  }

  /**
   * Connect to MCP servers before running investigations.
   * Must be called after construction, before execute()/stream().
   */
  async connectMcp(servers: MCPServerConfig[]): Promise<void> {
    await this.mcpClient.connect(servers)
    const tools = await this.mcpClient.getTools()
    const safeTools = wrapMcpToolsWithSafety(tools)

    // Rebuild graph with MCP tools included
    this.graph = buildInvestigationGraph({
      ...this.graphDeps,
      mcpTools: safeTools,
    })
  }

  async close(): Promise<void> {
    await this.mcpClient.close()
  }
}
```

**Design decision**: MCP connection happens once at executor construction, not per-investigation. Tools are discovered once and shared across investigations.

## Step 5: MCP Tool Sandboxing

Safety measures for MCP tools:

| Measure | Default | Configurable |
|---------|---------|--------------|
| Timeout per tool call | 30s | `MCPToolSafetyOptions.timeoutMs` |
| Max calls per investigation | 10 | `MCPToolSafetyOptions.maxCallsPerInvestigation` |
| Error isolation | return error string | `MCPToolSafetyOptions.onError` |
| Logging | All calls logged with input/output | Always on |

MCP tool failures don't crash the investigation. They return error strings that the LLM can interpret.

## Step 6: Seed IntegrationDefinition for MCP

**Create**: `api/src/modules/integrations/mcp-definition-seed.ts`

```typescript
export async function seedMcpDefinition(prisma: PrismaClient): Promise<void> {
  await prisma.integrationDefinition.upsert({
    where: { slug: "mcp" },
    create: {
      name: "MCP Server",
      slug: "mcp",
      description: "Model Context Protocol server for custom tool integration",
      category: "mcp",
      authType: "api_key",
      configSchema: {
        type: "object",
        properties: {
          transport: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["sse", "streamable-http", "stdio"] },
              url: { type: "string" },
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
            },
            required: ["type"],
          },
          serverName: { type: "string" },
        },
        required: ["transport"],
      },
    },
    update: {},
  })
}
```

## Step 7: Frontend MCP Settings Page

**Create**: Frontend settings section for MCP server management.

This reuses the existing integration settings pattern:
- Add/remove MCP server connections
- Configure transport (SSE URL or stdio command)
- Test connection (ping the MCP server)
- View available tools per server
- Enable/disable per investigation

**Files**:
- `frontend/src/components/settings/mcp-servers-section.tsx` — Settings UI
- Uses existing `IntegrationConnection` CRUD hooks from `use-integrations-orpc.ts`

**Key UI elements**:
- Table of configured MCP servers with status (connected/disconnected)
- "Add Server" form with transport type selector
- "Test Connection" button per server
- "Available Tools" expandable section showing discovered tools

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/src/tools/mcp/client.ts` | Real MCPClientManager with @langchain/mcp-adapters |
| Modify | `agents/src/tools/mcp/converter.ts` | Safety wrappers for MCP tools |
| Create | `agents/src/tools/mcp/config.ts` | MCP server config from DB + config file |
| Modify | `agents/src/executor/investigation-executor.ts` | connectMcp() + rebuild graph with MCP tools |
| Modify | `agents/package.json` | Add @langchain/mcp-adapters dependency |
| Create | `api/src/modules/integrations/mcp-definition-seed.ts` | Seed IntegrationDefinition for MCP |
| Create | `frontend/src/components/settings/mcp-servers-section.tsx` | MCP server management UI |

## Tests

### Unit Tests

**Create**: `agents/src/__tests__/mcp/client.test.ts`
- Connect to mock MCP server -> verify tool discovery
- Empty server list -> getTools returns []
- Connection failure -> handled gracefully
- close() cleans up resources

**Create**: `agents/src/__tests__/mcp/converter.test.ts`
- Safety wrapper: timeout triggers error return
- Safety wrapper: rate limit triggers error return
- Safety wrapper: tool error returns error string (not throw)

**Create**: `agents/src/__tests__/mcp/config.test.ts`
- Resolve from integrations only
- Resolve from config file only
- Merge both sources
- Missing config file -> no error

### Integration Tests

**Create**: `agents/src/__tests__/mcp/integration.test.ts`
- End-to-end: connect MCP client -> get tools -> pass to gatherer -> gatherer uses MCP tool
- MCP tool results appear in gatheredData

## Verification

1. `pnpm typecheck` passes
2. `pnpm test` passes
3. Start a test MCP server (e.g., `@modelcontextprotocol/server-filesystem`)
4. Configure in PrismaLens (DB or config file)
5. Trigger investigation -> gatherer discovers and uses MCP tools
6. MCP tool results appear in gatheredData
7. Safety: timeout, rate limiting, error isolation all work
8. Frontend: MCP settings page shows configured servers and available tools
9. `close()` properly disconnects all MCP servers
