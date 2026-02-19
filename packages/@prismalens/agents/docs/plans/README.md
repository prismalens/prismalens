# PrismaLens Agents: Multi-Phase Implementation Plan

> **Active Development** — No legacy code, no production data, no backward compatibility requirements. All changes are clean upgrades.

## Architecture Overview

```
Alert Ingestion
      |
      v
  [START] ──> [scout] ──> [supervisor] ──> [__end__]
                              │   ^
                              │   │
                    ┌─────────┼───┤
                    │         │   │
                    v         v   │
              [gatherer] [analyst] [resolver]
                    │         │        │
                    └─────────┴────────┘
                         (loop back to supervisor)
```

**Graph topology**: `START -> scout -> supervisor -> {gatherer, analyst, resolver} -> supervisor -> ... -> __end__`

- **Scout**: Function node (no LLM). Fetches incident + alerts via DataProvider, enriches with timeline/topology.
- **Supervisor**: LLM routing node with deterministic guards. Uses `Command({ goto, update })` for routing.
- **Gatherer**: `createReactAgent` wrapper with skill-based tools. Collects logs, code, deployments, metrics.
- **Analyst**: Subgraph with parallel hypothesis evaluation via `Send()`.
- **Resolver**: Subgraph with precedent lookup and human-in-the-loop approval gates via `interrupt()`.

## Plan Chain

| Phase | File | Status | Summary | Dependencies |
|-------|------|--------|---------|--------------|
| 1 | [phase-1-scaffold.md](./phase-1-scaffold.md) | COMPLETED | Architecture scaffold: state, types, graph, executor, providers | None |
| 0.5 | [phase-0.5-enum-sync.md](./phase-0.5-enum-sync.md) | PLANNED | Dynamic enum sync: Prisma -> contracts -> agents | Phase 1 |
| 2 | [phase-2-scout.md](./phase-2-scout.md) | PLANNED | Scout node + type alignment + 8 ADRs | Phase 0.5 |
| 3 | [phase-3-skills-tools.md](./phase-3-skills-tools.md) | PLANNED | Wire skills to real integrations + token tracking | Phase 2 |
| 4 | [phase-4-gatherer.md](./phase-4-gatherer.md) | PLANNED | Gatherer agent (createReactAgent wrapper) | Phase 3 |
| 5 | [phase-5-supervisor.md](./phase-5-supervisor.md) | PLANNED | Supervisor LLM routing + streaming + consumer migration | Phase 4, Phase 2 |
| 6 | [phase-6-analyst.md](./phase-6-analyst.md) | PLANNED | Analyst subgraph (hypothesis-driven) | Phase 5 |
| 7 | [phase-7-resolver.md](./phase-7-resolver.md) | PLANNED | Resolver subgraph (precedent + approval) | Phase 5 |
| 8 | [phase-8-mcp.md](./phase-8-mcp.md) | PLANNED | MCP tool discovery + user extensions | Phase 4, Phase 5 |

## Dependency Graph

```
Phase 1 (DONE)
    |
Phase 0.5 (enum sync)
    |
Phase 2 (scout + ADRs)
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

**Critical path**: 1 -> 0.5 -> 2 -> 3 -> 4 -> 5 (full graph working)

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

1. **DB AgentName enum is stale**: `alert_agent`, `gatherer_agent`, `analyzer_agent`, `recommender_agent` -> needs update to `scout`, `gatherer`, `analyst`, `resolver`, `supervisor`
2. **No ChangeEventsService**: Model exists, service doesn't -> must create in Phase 3
3. **No Runbook models**: Resolver precedent = query `Investigation` table + `Service.metadata` JSON
4. **No MCP models**: Reuse `IntegrationConnection` with `category: "mcp"` instead
5. **Contracts schema completely stale**: References `validateIncident`, `preGather`, `detective`, `adversary`, `surgeon`
6. **Frontend has no SSE**: Pure polling -> must build SSE from scratch in Phase 5
7. **Agent Recommendation type vs DB Recommendation model**: Agent has `type: "immediate"|"short_term"|"long_term"`, DB has `category: RecommendationCategory` -> must reconcile
8. **Missing dependencies**: `vitest`, `@langchain/langgraph-checkpoint-postgres`, `@langchain/mcp-adapters`

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
| Gatherer | `createReactAgent` wrapper | Yes | Skills (log, code, change, precedent) + MCP |
| Analyst | Subgraph (5 nodes) | Yes (3 LLM nodes) | Verification tools |
| Resolver | Subgraph (4 nodes) | Yes (2 LLM nodes) | Precedent tools + `interrupt()` |

### State Architecture (5 Layers)

```
Layer 1: Input        — investigationId, incidentId, config, integrations
Layer 2: Control      — phase, iterations, lastProgressSnapshot, errors
Layer 3: Gathered     — incident, alerts, gatheredData (scout + gatherer populate)
Layer 4: Data Requests — needsMoreData, dataGaps (analyst -> supervisor -> gatherer loop)
Layer 5: Results      — hypotheses[], recommendations[] (append-only via reducers)
```
