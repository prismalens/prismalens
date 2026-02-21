# @prismalens/config

Runtime configuration, environment variable validation, and identity registries for infrastructure concerns (agents, LLM providers, MCP servers).

## Sub-exports

| Export path | Contents | Runtime deps | Safe for |
|-------------|----------|-------------|----------|
| `@prismalens/config` | Env var schemas, `getConfig()`, secrets management | `zod`, `dotenv`, Node.js `fs`/`crypto` | **Node.js only** (API, worker) |
| `@prismalens/config/agents` | Agent identity registry, `agentIdSchema` | `zod` only | All (browser-safe) |
| `@prismalens/config/llm` | LLM provider metadata, `llmProviderIdSchema` | `zod` only | All (browser-safe) |
| `@prismalens/config/mcp` | MCP server metadata, transport schemas | `zod` only | All (browser-safe) |

## What belongs here

- **Environment variable schemas**: Zod validation for all env vars
- **Runtime configuration**: `getConfig()`, `validateConfig()`, database URL computation
- **Secrets management**: Encryption key generation, internal secret auto-provisioning
- **Identity registries**: Agent names/roles/descriptions, LLM provider metadata, MCP server catalog
- **Infrastructure metadata**: Provider URLs, credential mappings, transport schemas

## What does NOT belong here

- Business domain enums like `Severity`, `AlertStatus` (`@prismalens/contracts`)
- Entity schemas like `AlertSchema`, `IncidentSchema` (`@prismalens/contracts`)
- API route definitions (`@prismalens/contracts`)
- Prisma model types (`@prismalens/database`)

## Browser-safe vs Node-only

The main export (`@prismalens/config`) requires Node.js — it uses `dotenv`, `fs`, and `crypto`. The sub-exports (`/agents`, `/llm`, `/mcp`) are browser-safe and only depend on `zod`.

```typescript
// Node.js only (API, worker)
import { getConfig } from "@prismalens/config";

// Browser-safe (frontend, agents, any consumer)
import { INVESTIGATION_AGENTS, agentIdSchema } from "@prismalens/config/agents";
import { LLM_PROVIDERS, llmProviderIdSchema } from "@prismalens/config/llm";
import { MCP_SERVERS, mcpServerIdSchema } from "@prismalens/config/mcp";
```

## Boundary with contracts

Config owns **"what infrastructure exists"** — agent names, LLM providers, MCP servers. Contracts imports from config to build Zod validation schemas (e.g., `AgentNameSchema = z.enum(AGENT_IDS)`). Config never imports from contracts.

```
@prismalens/config/agents  ──exports──>  AGENT_IDS
                                              │
                                              ▼
@prismalens/contracts/schemas  ──uses──>  AgentNameSchema = z.enum(AGENT_IDS)
```
