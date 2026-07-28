# @prismalens/contracts

Single Source of Truth (SSOT) for all business domain types: Zod enum schemas, entity schemas, and oRPC API route contracts.

## Sub-exports

| Export path | Contents | Runtime deps | Safe for |
|-------------|----------|-------------|----------|
| `@prismalens/contracts/schemas` | Zod schemas + inferred types | `zod` only | All consumers (frontend, API, worker, agents) |
| `@prismalens/contracts/contracts` | oRPC route definitions | `@orpc/contract`, `zod` | API only |
| `@prismalens/contracts` | Everything combined | All | API only |

## What belongs here

- **Domain enums**: `Severity`, `AlertStatus`, `IncidentStatus`, `AgentType`, etc.
- **Entity schemas**: `AlertSchema`, `IncidentSchema`, `ServiceSchema`, etc.
- **Canonical events**: The `CanonicalEvent.kind` enumeration (`agent_step`, `tool_result`, `branch_done`, `error`, `report`, `llm_call`) and their payload shapes (including usage capture). See the [CLI README](../../cli/README.md#mode-2--driven-by-an-app-prismalens-serve) for wire format details.
- **API route contracts**: oRPC contract definitions for each endpoint group
- **Utility schemas**: pagination, date strings, JSON fields

## Investigation report: the `culprit` field (ADR-0026)

`InvestigationReportSchema.culprit` is a structured culprit identification synthesized by the
Tier-1 reduce: `{ service, changeRef, mechanism }`, each `string | null`. The whole object is
optional and may be `null`; when the model omits it or it cannot be parsed, it is `null` — never
a synthesized guess. It is **identification, not confidence** (ADR-0002): no numeric scores, and
it never orders hypotheses. Persisted records additionally carry `origin` (default `"local"`)
and `schemaVersion` (default `1`) identity stamps.

## What does NOT belong here

- Environment variables, runtime configuration (`@prismalens/config`)
- Agent identity registries, LLM provider metadata (`@prismalens/config`)
- Prisma model types (`@prismalens/database`)
- React components, hooks, or UI logic (`frontend`)

## Import patterns

```typescript
// API — full access (schemas + oRPC contracts)
import { alertsContract } from "@prismalens/contracts";
import type { Alert, Severity } from "@prismalens/contracts/schemas";

// Frontend — schemas only (no oRPC runtime)
import type { Incident, AlertStatus } from "@prismalens/contracts/schemas";

// Worker — schemas only
import type { AgentType, ExecutionStatus } from "@prismalens/contracts/schemas";

// Agents — schemas only
import { SeveritySchema } from "@prismalens/contracts/schemas";
```

## Adding a new enum

1. Add the Zod schema to `src/schemas/common.ts`:
   ```typescript
   export const MyEnumSchema = z.enum(["value_a", "value_b"]);
   export type MyEnum = z.infer<typeof MyEnumSchema>;
   ```
2. Build: `pnpm build`
3. Consumers import `MyEnum` type or `MyEnumSchema` for runtime validation.

## Adding a new entity schema

1. Create `src/schemas/my-entity.ts` with the Zod schema
2. Export from `src/schemas/index.ts`:
   ```typescript
   export * from "./my-entity.js";
   ```
3. (Optional) Create an oRPC contract in `src/contracts/` if the entity has API endpoints
4. Build: `pnpm build`

## Tree-shaking

The package has `"sideEffects": false` in `package.json`. Consumers importing only `@prismalens/contracts/schemas` will not pull in `@orpc/contract` runtime code.

## `InvestigationContext.contextPack` (host-assembled evidence)

An **optional** field on `InvestigationContext`, added for Phase 3 slice 0. Host-assembled facts
the harness cannot reach by iterating; the engine renders it and never fetches it (ADR-0011).
Extend-only per ADR-0015 — the field is optional and absent on the CLI/degenerate path.

Three families, all hard-capped by schema (`schemas/context-pack.ts`):

| family | cap | carries |
|---|---|---|
| `changes` | 20 | `kind` · `service` · `at` · `source` · `ref` · `summary` |
| `neighbors` | 20 | `name` · `relation` · `criticality` |
| `priorIncidents` | 5 | `reference` · `title` · `rootCause` · `matchedOn[]` |
| `unavailable` | 3 | `family` · `reason` — an honest "we could not fetch this" |

**No numeric score anywhere** (ADR-0002): ordering *is* the rank, and `matchedOn` carries the
honest "why". Every string field is sanitised at the render seam and emitted inside one fenced
DATA-ONLY block, so no value can close the fence and speak as the operator (#207).

Related report fields: `Evidence.origin` distinguishes a host-assembled fact from a tool
observation, and `InvestigationReport.flaggedContent` carries any injection attempt the run
observed — quoted as a specimen, never obeyed.
