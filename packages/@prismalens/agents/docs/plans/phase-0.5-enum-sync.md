# Phase 0.5: Enum Synchronization

**Status**: COMPLETED
**Dependencies**: Phase 1 (completed)
**Completed**: 2026-02-20
**Priority**: CRITICAL — must complete before Phase 2

## Goal

Eliminate duplication of enum values across contracts and agents. Establish `@prismalens/contracts/src/schemas/common.ts` (hand-maintained Zod schemas) as the SSOT for all shared DB-aligned enums. Use `@prismalens/config/agents` as the SSOT for agent identity.

## Context

The agents package (Phase 1 scaffold, commit `94a1fb6`) hardcoded string literal unions for severity, status, priority, etc. that were stale and incomplete compared to the DB schema. The same enum values were duplicated across 4 locations (Prisma PG schema, contracts Zod schemas, agents types, API TypeScript enums) with divergent values.

**Constraint**: The app supports both SQLite and PostgreSQL at runtime. SQLite has no native enums, so `prisma/generated/enums.ts` is empty. Prisma-generated TypeScript cannot be the SSOT — contracts hand-maintained Zod schemas are the SSOT instead.

## What Was Done

### Step 1: Package dependencies fixed

- Removed dead `@prismalens/agents` dep from `contracts/package.json` (no actual imports existed)
- Added `@prismalens/contracts: workspace:*` to `agents/package.json`

### Step 2: Contracts `common.ts` stale values fixed

| Change | Detail |
|--------|--------|
| `AgentNameSchema` | Now imports `AGENT_IDS` from `@prismalens/config/agents`, uses `z.enum(AGENT_IDS)`. Old: `alert_agent, gatherer_agent, ...` New: `scout, gatherer, analyst, resolver, supervisor` |
| `SettingTypeSchema` | Added `"encrypted"` (already in Prisma PG + API enums, contracts was behind) |
| `SettingCategorySchema` | Added `"setup"` (already in Prisma PG + API enums, contracts was behind) |

### Step 3: DEFERRED to Phase 5

The following files are **not touched in Phase 0.5** because they are deeply entangled with the streaming architecture built in Phase 5:

- `contracts/src/schemas/investigation-progress.ts` — stale phases/nodes, needs full redesign aligned with LangGraph `streamMode: ["updates", "custom"]` event shapes
- `api/src/modules/investigations/progress.service.ts` — reads checkpoints, maps to stale schema
- `frontend/src/components/investigations/InvestigationGraph.tsx` — renders stale node names

Phase 5 (`phase-5-supervisor.md`) already covers the `investigation-progress.ts` rewrite. The following gaps must be added to Phase 5:

1. **Remove `AgentExecution` and `ToolExecution` DB tables** — LangGraph checkpoints are the single source of execution data.
2. **Design progress schema around LangGraph stream events** — `streamMode: ["updates", "custom"]` produces node-level state deltas + custom progress events via `dispatchCustomEvent()`.
3. **Rewrite `InvestigationGraph.tsx`** — new graph visualization with 5 nodes (scout, supervisor, gatherer, analyst, resolver) driven by SSE stream events.
4. **Consider `useStream()` hook** from `@langchain/langgraph-sdk` instead of raw `EventSource`.
5. **Checkpoint-based state inspection** — `getState(threadConfig)` for current state + `state.next` for pending nodes + `getStateHistory()` for replay.
6. **Human-in-the-loop via `interrupt()`** — the progress schema must support interrupt state detection.

### Step 4: Hardcoded literals replaced in agents types

**`agents/src/types/contexts.ts`**:
- `IncidentContext.severity`: `"critical" | "high" | "medium" | "low"` → `Severity` (adds `"info"`)
- `IncidentContext.status`: 5 hardcoded values → `IncidentStatus` (adds `"identified"`, `"monitoring"`)
- `IncidentContext.priority`: inline union → `Priority`
- `AlertContext.severity`: 4 values → `Severity` (adds `"info"`)
- `AlertContext.status`: 3 values → `AlertStatus` (adds `"correlated"`, `"suppressed"`)

**`agents/src/types/results.ts`**:
- `InvestigationResult.rootCauseCategory`: `string | null` → `RootCauseCategory | null`
- `Evidence.severity`: 4-value union → `Severity`
- `Recommendation.type` → **renamed to** `Recommendation.urgency`, typed as `Urgency`
- `Recommendation.priority`: inline union → `RecommendationPriority`

**Consumers of `Recommendation.type` → `.urgency` fixed**:
- `worker/src/processor.ts` — `rec.type` → `rec.urgency`
- `api/src/infrastructure/queue/queue.service.ts` — `rec.type` mapping → `rec.urgency` (direct passthrough, no longer needs manual mapping)

**Additional fix**: `agents/src/agents/supervisor/node.ts` — uses `mapHypothesisCategoryToDb()` for runtime-safe mapping of `bestHypothesis.category` to `RootCauseCategory` (unknown categories fall back to `"unknown"`).

### Step 5: Agent role metadata and enum mapping utilities

**Added `role` property to `INVESTIGATION_AGENTS`** in `config/src/providers/agents.ts`:
- `scout` → `role: "entry"` (first node, not routable)
- `gatherer`, `analyst`, `resolver` → `role: "worker"` (routable by supervisor)
- `supervisor` → `role: "orchestrator"` (routes work, not routable)

**Derived `ROUTABLE_AGENT_IDS`** dynamically by filtering the registry for `role === "worker"`. Exported `RoutableAgentId` type via mapped type extraction. All exports wired through `config/src/agents.ts`.

**Created `agents/src/utils/enum-maps.ts`** — 4 mapping functions:
- `mapHypothesisCategoryToDb(agentCategory)` → `RootCauseCategory` (6→5 mapping)
- `mapAgentUrgencyToDb(agentUrgency)` → `Urgency` (4→3 mapping)
- `mapFixCategoryToDb(agentCategory)` → `RecommendationCategory` (5→5 mapping)
- `mapToolCategoryToDb(agentCategory)` → `ToolCategory` (7→5 mapping)

Exports wired through `utils/index.ts` and `src/index.ts`.

### Step 6: Supervisor made dynamic

**`agents/src/tools/schemas.ts`**:
- Extracted `INVESTIGATION_PHASES` as const tuple
- `SupervisorDecisionSchema.agent` uses `z.enum([...ROUTABLE_AGENT_IDS, "__end__"])`
- `SupervisorDecisionSchema.phase` uses `z.enum(INVESTIGATION_PHASES)`

**`agents/src/agents/supervisor/prompt.ts`**:
- Imports `INVESTIGATION_AGENTS` and `ROUTABLE_AGENT_IDS` from `@prismalens/config/agents`
- Agent descriptions in both `supervisorPrompt()` and `SUPERVISOR_PROMPT` are now generated dynamically via `buildAgentDescriptions()`

### Step 7: Severity utility fixed

**`agents/src/utils/severity.ts`**:
- Return type changed from `"critical" | "high" | "medium" | "low"` to `Severity`
- Added explicit `"low"` check with `p4`/`sev4` pattern matching (before `"info"`)
- Added `"info"` detection: `if (normalized.includes("info") || normalized.includes("informational"))` → returns `"info"`
- Ordering: critical → high → medium → low → info → default low

## Files Summary

| Action | File |
|--------|------|
| MODIFY | `packages/@prismalens/config/src/providers/agents.ts` |
| MODIFY | `packages/@prismalens/config/src/agents.ts` |
| MODIFY | `packages/@prismalens/contracts/package.json` |
| MODIFY | `packages/@prismalens/agents/package.json` |
| MODIFY | `packages/@prismalens/contracts/src/schemas/common.ts` |
| MODIFY | `packages/@prismalens/agents/src/types/contexts.ts` |
| MODIFY | `packages/@prismalens/agents/src/types/results.ts` |
| MODIFY | `packages/@prismalens/agents/src/types/state.ts` |
| MODIFY | `packages/@prismalens/agents/src/agents/supervisor/node.ts` |
| MODIFY | `packages/worker/src/processor.ts` |
| MODIFY | `packages/api/src/infrastructure/queue/queue.service.ts` |
| CREATE | `packages/@prismalens/agents/src/utils/enum-maps.ts` |
| MODIFY | `packages/@prismalens/agents/src/utils/index.ts` |
| MODIFY | `packages/@prismalens/agents/src/index.ts` |
| MODIFY | `packages/@prismalens/agents/src/tools/schemas.ts` |
| MODIFY | `packages/@prismalens/agents/src/agents/supervisor/prompt.ts` |
| MODIFY | `packages/@prismalens/agents/src/utils/severity.ts` |

**16 modified, 1 created** (17 files total across 5 packages)

## Out of Scope

- **API `shared/enums/index.ts`**: Used by 29 files. Migration to contract imports is a future task. Values already match.
- **Prisma PG `AgentName` enum**: Still has old values. Needs a DB migration. Deferred — investigation tables have no data yet.
- **Agent-internal enums** (`Evidence.type`, `Evidence.strength`, `Reversibility`, `CoverageAssessment`, `ChallengeResult.severity`): Intentionally agent-only, no DB backing. No sync needed.
- **`contracts/src/schemas/investigation-progress.ts`**: Stale phases/nodes deferred to Phase 5.

## Verification (Passed)

1. `pnpm install` — lockfile updated cleanly
2. `pnpm --filter @prismalens/contracts typecheck` — 0 errors
3. `pnpm --filter @prismalens/agents typecheck` — 0 errors
4. `pnpm --filter worker typecheck` — 0 errors
5. `pnpm --filter api typecheck` — 0 errors
6. `pnpm --filter @prismalens/contracts build` — success
7. `pnpm --filter @prismalens/agents build` — success
8. `pnpm typecheck` — 14/15 packages pass (1 pre-existing frontend vite type mismatch, unrelated)
9. Grep for stale agent names in agents source: no matches (only in docs/plans)
10. Grep for hardcoded severity unions in agents types: no matches
