# Dead Code Analysis Report

**Package**: `@prismalens/agents`
**Date**: 2026-01-24
**Status**: ✅ Cleanup Complete

---

## Summary

| Metric | Value |
|--------|-------|
| Files analyzed | ~50+ |
| Dead code found | 1 unused export |
| Items deleted | 1 |
| Tests passing | ✅ Yes |

---

## Deleted Items

### 1. `mapPriorityToIncidentPriority` function

- **Location**: `src/types/state.ts:817-827`
- **Type**: Unused exported function
- **Reason**: Zero usages found in entire codebase
- **Verification**: Typecheck + build pass, grep confirms no references

```typescript
// DELETED
export function mapPriorityToIncidentPriority(
  priority: "low" | "normal" | "high" | "critical",
): "p1" | "p2" | "p3" | "p4" | "p5" {
  const mapping = { critical: "p1", high: "p2", normal: "p3", low: "p4" };
  return mapping[priority] || "p3";
}
```

---

## Items Reviewed (Not Dead Code)

### Active Code

| Item | Location | Status |
|------|----------|--------|
| RateLimiter | tools/rate-limiter.ts | ✅ Used in factory.ts, MCP source |
| Tool disclosure middleware | middleware/tool-disclosure.ts | ✅ Used in subagents |
| All evals files | evals/ | ✅ Active test infrastructure |
| All exported types | types/state.ts | ✅ Used internally/externally |

### Placeholder Code (TODO - Not Dead)

These are incomplete implementations with TODO comments - unfinished features, not dead code:

| File | TODO |
|------|------|
| pre-gathering/changes.ts | Query ChangeEvent table |
| pre-gathering/metrics.ts | Calculate MTTA/MTTR |
| pre-gathering/service-context.ts | Query ServiceDependency table |
| pre-gathering/similar-incidents.ts | Query IncidentSimilarity table |
| pre-gathering/logs.ts | Query log aggregation via MCP |

### Maintenance Notes

| Item | Location | Notes |
|------|----------|-------|
| Inline state annotation | src/graph/studio.ts | Required for LangGraph Studio parser limitation |

---

## Verification

```bash
# Typecheck
pnpm --filter @prismalens/agents typecheck  # ✅ Pass

# Build
pnpm --filter @prismalens/agents build      # ✅ Pass

# Grep for deleted function
grep -r "mapPriorityToIncidentPriority"     # ✅ No matches
```

---

## Conclusion

The `@prismalens/agents` package is well-maintained with minimal dead code. Only one unused utility function was found and removed. The codebase is clean.
