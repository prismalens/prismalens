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
- **API route contracts**: oRPC contract definitions for each endpoint group
- **Utility schemas**: pagination, date strings, JSON fields

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
