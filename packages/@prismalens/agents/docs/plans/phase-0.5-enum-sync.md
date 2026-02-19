# Phase 0.5: Dynamic Enum Synchronization

**Status**: PLANNED
**Dependencies**: Phase 1 (completed)
**Estimated effort**: Half-day
**Priority**: CRITICAL — must complete before Phase 2

## Goal

Eliminate triple-duplication of enum values across Prisma schema, contracts, and agents. Establish a single source of truth chain: **Prisma schema -> `@prismalens/database` (generated) -> `@prismalens/contracts` (Zod wrappers) -> `@prismalens/agents` (imports)**.

## The Problem: Triple Duplication

The same concepts are defined in 3 places with divergent values:

1. **Prisma schema** (`database/prisma/pg/schema/app.prisma`) — native PostgreSQL enums -> generates TypeScript const objects + types in `database/prisma/generated/enums.ts`
2. **Contracts** (`@prismalens/contracts/src/schemas/common.ts`) — hand-coded Zod schemas duplicating Prisma
3. **Agents** (`@prismalens/agents/src/types/`) — inline string literal unions, often stale/incomplete

### Current Agent Types (Hardcoded)

```typescript
// agents/src/types/contexts.ts — HARDCODED
severity: "critical" | "high" | "medium" | "low"              // Missing: "info"
status: "triggered" | "acknowledged" | "resolved"              // Missing: "correlated", "suppressed"

// agents/src/types/state.ts — HARDCODED
type InvestigationPhase = "pre_gathering" | "gathering" | "analysis" | "resolution" | "completed"
type AgentName = "scout" | "gatherer" | "analyst" | "resolver" | "supervisor"
```

## Solution: Derive Everything from Prisma

**Chain**: Prisma schema -> `@prismalens/database` (generated) -> `@prismalens/contracts` (Zod wrappers) -> `@prismalens/agents` (imports)

Prisma-generated enums already exist and are exported:
```typescript
// database/prisma/generated/enums.ts (auto-generated)
export const AlertStatus = { triggered: 'triggered', acknowledged: 'acknowledged', ... } as const
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus]

// database/index.ts (already re-exports them)
export * from "./prisma/generated/client.js"  // includes all enums
```

## Per-Discrepancy Resolution Table

| # | Concept | Issue | Resolution |
|---|---------|-------|------------|
| 1 | **Severity** | Agents missing `info` | Import `Severity` type from contracts (derived from Prisma) |
| 2 | **AlertStatus** | Agents missing `correlated`, `suppressed` | Import `AlertStatus` from contracts |
| 3 | **IncidentStatus** | Agents has wrong `acknowledged`, missing `identified`, `monitoring` | Import `IncidentStatus` from contracts |
| 4 | **Priority** | Already matches, but hardcoded | Import from contracts for consistency |
| 5 | **AgentName** | Prisma enum has old names (`alert_agent`, etc.) | **Update Prisma enum** to `scout, gatherer, analyst, resolver, supervisor` |
| 6 | **InvestigationPhase** | Contracts has 7 stale phases | Agents is source of truth. Contracts imports from agents |
| 7 | **GraphNodeId** | Contracts has 15 stale node names | Derive from agents `AgentName` + `__start__`/`__end__` |
| 8 | **RootCauseCategory** | Agents uses finer categories than DB | **Update Prisma enum** to include agent's finer-grained values |
| 9 | **RecommendationCategory** | Agents has `infrastructure`, `escalation` not in DB | **Update Prisma enum** to union of both |
| 10 | **Urgency** | Agents has `next_hour`, `next_day`, `backlog` not in DB | **Update Prisma enum** to agents' more granular values |
| 11 | **WorkflowStatus** | Hardcoded strings in API services | Import from contracts/database |
| 12 | **ToolCategory** | DB vs agent categories diverge | **Update Prisma enum** to match agent categories |
| 13 | **Recommendation.type** | Agent field `type` doesn't match DB field `urgency` | Rename agent `Recommendation.type` -> `Recommendation.urgency` |
| 14-16 | **Evidence types, strength, reversibility** | Agent-only concepts, no DB equivalent | Agent-internal. No sync needed |
| 17 | **Supervisor prompt** | Hardcoded agent names in text | Use template literals with `ROUTABLE_AGENTS` constant |
| 18 | **SupervisorDecision schema** | Hardcoded `z.enum([...])` | Derive from `ROUTABLE_AGENTS` constant |

## Implementation Steps

### Step 1: Add contracts dependency to agents

```diff
// agents/package.json
"dependencies": {
+   "@prismalens/contracts": "workspace:*",
    "@langchain/anthropic": "^1.3.4",
    ...
}
```

Agents imports enum types/Zod schemas from contracts. Does **NOT** depend on database directly (keeps agents lightweight, no Prisma client in agent runtime).

### Step 2: Make contracts derive from Prisma enums

**Modify**: `contracts/src/schemas/common.ts`

```typescript
import { AlertStatus, IncidentStatus, Severity, Priority, ... } from "@prismalens/database"

// Derive Zod schemas from Prisma-generated const objects
export const SeveritySchema = z.enum(
  Object.values(Severity) as [string, ...string[]]
)
export type SeverityType = z.infer<typeof SeveritySchema>

export const AlertStatusSchema = z.enum(
  Object.values(AlertStatus) as [string, ...string[]]
)
// ... same pattern for all enums
```

When a Prisma enum changes, contracts auto-update, and agents auto-update.

### Step 3: Replace hardcoded literals in agents

**Modify**: `agents/src/types/contexts.ts`

```typescript
import type { Severity, AlertStatus, IncidentStatus, Priority } from "@prismalens/contracts"

export interface AlertContext {
  severity: Severity    // was: "critical" | "high" | "medium" | "low"
  status: AlertStatus   // was: "triggered" | "acknowledged" | "resolved"
  ...
}

export interface IncidentContext {
  severity: Severity
  status: IncidentStatus
  priority: Priority
  ...
}
```

**Modify**: `agents/src/types/state.ts` — keep `InvestigationPhase` and `AgentName` as source of truth (agent-only concepts not in DB yet)

**Modify**: `agents/src/types/results.ts` — import `RecommendationPriority`, `Urgency` from contracts. Rename `Recommendation.type` to `Recommendation.urgency`.

### Step 4: Export agent-only types for contracts to import

Contracts progress schema needs `InvestigationPhase`, `AgentName` from agents. The dependency already exists: contracts can reference agents.

```typescript
// contracts/src/schemas/investigation-progress.ts
import { type InvestigationPhase, type AgentName } from "@prismalens/agents"
export const PhaseSchema = z.enum(["pre_gathering", "gathering", "analysis", "resolution", "completed"])
```

### Step 5: Create mapping functions for misaligned concepts

**Create**: `agents/src/utils/enum-maps.ts`

```typescript
import type { RootCauseCategory, ToolCategory } from "@prismalens/contracts"

// Agent hypothesis categories -> DB root cause categories
const HYPOTHESIS_TO_DB: Record<string, RootCauseCategory> = {
  code_bug: "code",
  config_change: "config",
  infrastructure: "infrastructure",
  dependency: "external",
  deployment: "code",
  unknown: "unknown",
}

export function mapHypothesisCategoryToDb(agentCategory: string): RootCauseCategory {
  return HYPOTHESIS_TO_DB[agentCategory] ?? "unknown"
}

// Agent tool categories -> DB tool categories
const TOOL_TO_DB: Record<string, ToolCategory> = {
  log: "logs",
  code: "search",
  change: "github",
  precedent: "analysis",
  analyst: "analysis",
  resolver: "analysis",
  mcp: "search",
}

export function mapToolCategoryToDb(agentCategory: string): ToolCategory {
  return TOOL_TO_DB[agentCategory] ?? "analysis"
}
```

### Step 6: Make supervisor prompt dynamic

**Create**: `agents/src/agents/constants.ts`

```typescript
export const ROUTABLE_AGENTS = ["gatherer", "analyst", "resolver"] as const
export type RoutableAgent = typeof ROUTABLE_AGENTS[number]
```

**Modify**: `agents/src/agents/supervisor/prompt.ts`

```typescript
import { ROUTABLE_AGENTS } from "../constants.js"

export const supervisorPrompt = (context) => `
...
Available agents: ${ROUTABLE_AGENTS.join(", ")}, __end__
...
`
```

### Step 7: Make SupervisorDecision schema dynamic

**Modify**: `agents/src/tools/schemas.ts`

```typescript
import { ROUTABLE_AGENTS } from "../agents/constants.js"

export const SupervisorDecisionSchema = z.object({
  agent: z.enum([...ROUTABLE_AGENTS, "__end__"]),
  ...
})
```

## Concepts That Cannot Be Made Dynamic

| Concept | Why | Mitigation |
|---------|-----|------------|
| `Evidence.type` | Agent-internal, no DB backing, LLM structured output categories | Keep in agents, no sync needed |
| `Evidence.strength` | Agent-internal, for LLM scoring | Keep in agents |
| `Reversibility` | Agent-internal, for risk assessment | Keep in agents |
| `Coverage assessment` | Agent-internal, for data quality | Keep in agents |
| `Challenge severity` | Agent-internal, for contradiction scoring | Keep in agents |
| Hypothesis category (fine-grained) | Agent needs more granular than DB `RootCauseCategory` | Keep in agents, use `mapHypothesisCategoryToDb()` when persisting |
| Agent `ToolCategory` vs DB `ToolCategory` | Different purposes (routing vs audit) | Keep separate, use `mapToolCategoryToDb()` when persisting |

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/package.json` | Add `@prismalens/contracts` dependency |
| Modify | `contracts/src/schemas/common.ts` | Derive Zod schemas from Prisma enums |
| Modify | `agents/src/types/contexts.ts` | Import types from contracts |
| Modify | `agents/src/types/results.ts` | Import RecommendationPriority, Urgency; rename `type` -> `urgency` |
| Modify | `agents/src/tools/schemas.ts` | Use dynamic enums from constants |
| Create | `agents/src/agents/constants.ts` | ROUTABLE_AGENTS, AgentName constants |
| Create | `agents/src/utils/enum-maps.ts` | Mapping functions for misaligned concepts |
| Modify | `agents/src/agents/supervisor/prompt.ts` | Use ROUTABLE_AGENTS in template |
| Modify | `contracts/src/schemas/investigation-progress.ts` | Import phases/agents from agents package |

## Tests

- Verify `SeveritySchema.parse("info")` succeeds (previously missing)
- Verify `AlertStatusSchema.parse("correlated")` succeeds
- Verify `mapHypothesisCategoryToDb("code_bug")` returns `"code"`
- Verify `mapToolCategoryToDb("log")` returns `"logs"`
- Verify `SupervisorDecisionSchema` accepts all routable agents

## Verification

1. `pnpm typecheck` passes across agents, contracts, and database packages
2. No hardcoded string literal unions remain in agents `types/` (except agent-internal concepts)
3. Changing a Prisma enum value propagates to contracts Zod schemas automatically
4. All existing tests continue to pass
