# Phase 1.5: Complete SSOT Alignment

**Status**: COMPLETED
**Dependencies**: Phase 0.5 (enum sync)
**Actual effort**: Single session

## Goal

Fix all 7 SSOT gaps found during structural audit. Ensure every package derives domain types from `@prismalens/contracts/schemas` — no duplicates, no inline literals, no untyped serializers.

## Gaps Fixed

| # | Gap | Resolution |
|---|-----|------------|
| 0 | Contracts missing `sideEffects: false` | Added to `package.json` |
| 1 | 29 duplicate TS enums in API | Replaced with Zod `.enum` derivations from contracts |
| 2a | 15+ DTOs importing from duplicate enums | Now import contract-derived types via `shared/enums` |
| 2b | 5 DTOs with inline string literals | Replaced with contract enum types |
| 3 | 11 controllers with `serialize*(any): any` | Typed with contract schema output types |
| 4 | License three-way divergence | Unified to 2-tier model (community/enterprise) across DB, API, frontend |
| 5 | Worker types using `string` | Replaced with contract enum types |
| 6 | Missing schemas: ChangeEvent, IncidentSimilarity, LicenseInfo | Created in contracts |

## Files Changed

### Contracts (`@prismalens/contracts`)
- `package.json` — added `sideEffects: false`
- `src/schemas/common.ts` — added ChangeEventType, LicenseType, LicenseTier enums
- `src/schemas/change-event.ts` — new
- `src/schemas/incident-similarity.ts` — new
- `src/schemas/license.ts` — new
- `src/schemas/index.ts` — added exports

### API (`packages/api`)
- `src/shared/enums/index.ts` — rewritten (Zod derivation, no TS enums)
- 5 DTOs — replaced inline string literals with enum types
- 11 controllers — typed serialize methods
- `src/core/license/license.constants.ts` — derives from contract types
- All consumers — updated from UPPER_CASE to lowercase enum member access

### Worker (`packages/worker`)
- `src/types.ts` — contract enum types for recommendations, agent executions, tool executions

### Frontend (`packages/frontend`)
- `src/lib/license/constants.ts` — 2-tier model, derives from contracts
- `src/lib/license/index.ts` — removed stale exports
- `src/lib/license/license-context.tsx` — updated default tier
- `src/components/shared/FeatureGate.tsx` — updated comments

### Database (`@prismalens/database`)
- SQLite schema — updated license comments
- PG schema — updated LicenseType/LicenseTier enums to 2-tier

## Key Decisions

1. **Zod `.enum` over TS `enum`**: Contract schemas produce `{ critical: "critical", ... }` objects. Consumers use lowercase keys (`Severity.critical`). `@IsEnum()` decorator works with these objects.

2. **2-tier license model**: Community (open-source, no key) and Enterprise (subscription). Removed `perpetual`, `free_plus`, `beginner`, `team`, `business` tiers.

3. **Serializer typing**: Input uses `Record<string, any>` or Prisma model types. Output uses contract schema types. Method bodies unchanged.

## Verification

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] No `enum` keyword in `api/src/shared/enums/`
- [ ] No `any` return type on `serialize*` methods
- [ ] No inline string literal unions in DTOs
- [ ] Worker types use contract enums
- [ ] Frontend + API license constants derive from contracts
