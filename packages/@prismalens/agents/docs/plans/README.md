# PrismaLens Agents: Multi-Phase Implementation Plan

> **Active Development** — No legacy code, no production data, no backward compatibility requirements. All changes are clean upgrades.

## Architecture Overview

```
Alert Ingestion
      |
      v
  [START] ──> [scout] ──> [analyst] ──> [supervisor] ──> [__end__]
                                            │   ^
                                   ┌────────┼───┤
                                   v        v   │
                             [gatherer] [analyst] [resolver]
                                   │        │        │
                                   └────────┴────────┘
                                    (loop back to supervisor)
```

**Graph topology**: `START -> scout -> analyst (deterministic) -> supervisor -> {gatherer, analyst, resolver, __end__} -> supervisor -> ... -> __end__`

**Key design**: Scout collects internal PrismaLens data, then analyst does first-pass analysis and makes targeted data requests for the gatherer. The supervisor routes based on agent self-assessments.

- **Scout**: Function node (no LLM). Fetches incident + alerts via DataProvider, enriches with timeline/topology.
- **Supervisor**: LLM routing node with deterministic guards. Uses `Command({ goto, update })` for routing.
- **Gatherer**: `createDeepAgent` wrapper with SKILL.md-based progressive tool disclosure. Collects logs, code, deployments, metrics.
- **Analyst**: Subgraph with parallel hypothesis evaluation via `Send()`.
- **Resolver**: Subgraph with precedent lookup and human-in-the-loop approval gates via `interrupt()`.

## Plan Chain

| Phase | File | Status | Summary | Dependencies |
|-------|------|--------|---------|--------------|
| 1 | [phase-1-scaffold.md](./phase-1-scaffold.md) | COMPLETED | Architecture scaffold: state, types, graph, executor, providers | None |
| 0.5 | [phase-0.5-enum-sync.md](./phase-0.5-enum-sync.md) | COMPLETED | Enum sync: contracts SSOT, agents imports, dynamic supervisor | Phase 1 |
| 1.5 | [phase-1.5-contracts-ssot.md](./phase-1.5-contracts-ssot.md) | COMPLETED | Complete SSOT alignment: schemas, enums, serializers, license | Phase 0.5 |
| 2 | [phase-2-scout.md](./phase-2-scout.md) | COMPLETED | Scout node + type alignment | Phase 1.5 |
| 3 | [phase-3-skills-tools.md](./phase-3-skills-tools.md) | COMPLETED | load_skill progressive disclosure + ChangeEventsService | Phase 2 |
| 4 | [phase-4-gatherer.md](./phase-4-gatherer.md) | COMPLETED | Gatherer agent (createReactAgent wrapper, all tools upfront) | Phase 3 |
| 5A | [phase-5-supervisor.md](./phase-5-supervisor.md) | IN PROGRESS | Supervisor LLM routing + graph wiring + self-assessments | Phase 4.5 |
| 5B | (planned) | PLANNED | Streaming (executor.stream(), config.writer) | Phase 5A |
| 5C | (planned) | PLANNED | Consumer migration (API, Worker, SSE, Frontend) | Phase 5B |
| 6 | [phase-6-analyst.md](./phase-6-analyst.md) | PLANNED | Analyst subgraph (hypothesis-driven) | Phase 5 |
| 7 | [phase-7-resolver.md](./phase-7-resolver.md) | PLANNED | Resolver subgraph (precedent + approval) | Phase 5 |
| 8 | [phase-8-mcp.md](./phase-8-mcp.md) | PLANNED | MCP tool discovery + user extensions | Phase 4, Phase 5 |

## Dependency Graph

```
Phase 1 (DONE)
    |
Phase 0.5 (DONE)
    |
Phase 1.5 (DONE)
    |
Phase 2 (scout)
    |
    +---> Phase 3 (skills/tools) ---> Phase 4 (gatherer) ---+
    |                                                        |
    +---> Phase 8 (MCP) ------------------------------------+
                                                             |
                                                        Phase 5 (supervisor + streaming)
                                                             |
                                               +-------------+-------------+
                                               |                           |
                                          Phase 6 (analyst)          Phase 7 (resolver)
```

**Critical path**: 1 -> 0.5 -> 1.5 -> 2 -> 3 -> 4 -> 5 (full graph working)

**Parallel tracks**:
- Phases 6 and 7 can start stubs early but need Phase 5 for full testing
- Phase 8 needs Phases 4+5 but can develop alongside 6-7

## Truth Sources

Every phase plan is grounded against these monorepo files:

| Source | Path | What it grounds |
|--------|------|-----------------|
| PostgreSQL Schema | `packages/@prismalens/database/prisma/pg/schema/app.prisma` | All DB models, enums, relationships, field types |
| QueueService | `packages/api/src/infrastructure/queue/queue.service.ts` | Regular mode execution, buildExecutorInput, persistResults |
| InvestigationsService | `packages/api/src/modules/investigations/investigations.service.ts` | Result persistence, writeResultWithRelations |
| InvestigationTriggerService | `packages/api/src/modules/investigations/investigation-trigger.service.ts` | Tier configs, trigger types |
| ProgressService | `packages/api/src/modules/investigations/progress.service.ts` | Checkpoint-based progress reading |
| CorrelationService | `packages/api/src/modules/correlation/correlation.service.ts` | 4-tier correlation, 60min hardcoded windows |
| IntegrationsService | `packages/api/src/modules/integrations/integrations.service.ts` | Credential decryption, getIntegrationsByConnectionIds |
| CredentialsService | `packages/api/src/modules/integrations/crypto/credentials.service.ts` | AES-256-GCM encryption |
| Worker Processor | `packages/worker/src/processor.ts` | WorkerDataProvider, credential fetch via internal API |
| Investigation Contracts | `packages/@prismalens/contracts/src/contracts/investigations.ts` | getProgress, getProgressHistory endpoints |
| Frontend Hooks | `packages/frontend/src/lib/api/hooks/use-investigations-orpc.ts` | Polling with refetchInterval:2000, NO SSE |
| LLM Factory | `packages/@prismalens/agents/src/llm/factory.ts` | 6 providers, env var API keys |
| Agents package.json | `packages/@prismalens/agents/package.json` | Current deps, missing vitest/checkpoint-postgres/mcp-adapters |

## Key Discrepancies Found

1. ~~**DB AgentName enum is stale**~~: `alert_agent`, `gatherer_agent`, etc. — **Contracts fixed (Phase 0.5)**. Prisma PG enum still needs DB migration (deferred, no data in tables yet)
2. ~~**No ChangeEventsService**~~: **Created (Phase 3)** — `ChangeEventsService` + `DirectDataProvider` wiring
3. **No Runbook models**: Resolver precedent = query `Investigation` table + `Service.metadata` JSON
4. **No MCP models**: Reuse `IntegrationConnection` with `category: "mcp"` instead
5. ~~**Contracts schema completely stale**~~: `AgentNameSchema` fixed (Phase 0.5). `investigation-progress.ts` still stale — deferred to Phase 5
6. **Frontend has no SSE**: Pure polling -> must build SSE from scratch in Phase 5
7. ~~**Agent Recommendation type vs DB Recommendation model**~~: **Fixed (Phase 0.5)** — renamed `Recommendation.type` to `Recommendation.urgency`, consumers updated
8. **Missing dependencies**: ~~`vitest`~~ (Phase 2), ~~`deepagents`, `langchain`~~ (Phase 4.5), Remaining: `@langchain/langgraph-checkpoint-postgres`, `@langchain/mcp-adapters`

## Conventions

### Path Prefixes

All paths in plan files use these shorthand prefixes:

| Prefix | Full Path |
|--------|-----------|
| `agents:` | `packages/@prismalens/agents/src/` |
| `api:` | `packages/api/src/` |
| `worker:` | `packages/worker/src/` |
| `contracts:` | `packages/@prismalens/contracts/src/` |
| `frontend:` | `packages/frontend/src/` |
| `database:` | `packages/@prismalens/database/` |

### Verification Standards

Every phase must pass:
1. `pnpm typecheck` (zero errors)
2. `pnpm test` (all tests pass) — once test infrastructure added
3. Phase-specific verification criteria documented in each plan

### Agent Patterns

| Agent | LangGraph Pattern | LLM | Tools |
|-------|------------------|-----|-------|
| Scout | Function node | No | DataProvider methods |
| Supervisor | Function node | Yes (structured output) | None (reads state) |
| Gatherer | `createDeepAgent` wrapper with SKILL.md skills + ToolGatingMiddleware | Yes | Skills (log, code, change, precedent) + MCP — progressively disclosed |
| Analyst | `createDeepAgent` (Phase 6 — planned) | Yes | Verification tools — via skills/analyst/ SKILL.md files |
| Resolver | `createDeepAgent` (Phase 7 — planned) | Yes | Precedent tools + HITL — via skills/resolver/ SKILL.md files |

### State Architecture (5 Layers)

```
Layer 1: Input        — investigationId, incidentId, config, integrations
Layer 2: Control      — phase, iterations, lastProgressSnapshot, errors
Layer 3: Gathered     — incident, alerts, gatheredData (scout + gatherer populate)
Layer 4: Data Requests — needsMoreData, dataGaps (analyst -> supervisor -> gatherer loop)
Layer 5: Results      — hypotheses[], recommendations[] (append-only via reducers)
```
