# Dead Code Analysis Report

Generated: 2026-01-31

## Summary

Analysis performed using:
- **knip**: Unused exports, files, and dependencies
- **depcheck**: Unused dependencies

---

## 1. Unused Dependencies

### Production Dependencies (CAUTION)

| Dependency | Status | Recommendation |
|------------|--------|----------------|
| `@langchain/community` | Unused | Review - may be needed for future features |

### Dev Dependencies (SAFE to remove)

| Dependency | Status | Recommendation |
|------------|--------|----------------|
| `@vitest/coverage-v8` | Unused | **SAFE** - Coverage tool, remove if not using |
| `agentevals` | Unused | **SAFE** - Eval tool, remove if not using |
| `tsx` | Unused | **SAFE** - TypeScript executor, may be used in scripts |
| `@langchain/langgraph-cli` | Unused | **SAFE** - CLI tool for development |

---

## 2. Unused Files (Index Files)

These files exist but have no imports:

| File | Status | Recommendation |
|------|--------|----------------|
| `evals/components/index.ts` | Barrel file | **SAFE** - Keep for organization |
| `evals/fixtures/index.ts` | Barrel file | **SAFE** - Keep for organization |
| `evals/fixtures/integrations.ts` | Test fixture | **SAFE** - Keep for tests |
| `evals/graph/index.ts` | Barrel file | **SAFE** - Keep for organization |
| `evals/tools/index.ts` | Barrel file | **SAFE** - Keep for organization |
| `src/mcp/index.ts` | Barrel file | **SAFE** - Keep for organization |
| `src/middleware/index.ts` | Barrel file | **SAFE** - Keep for organization |
| `src/tools/capabilities.ts` | Utility file | **CAUTION** - Review usage |
| `src/agents/analysis/index.ts` | Barrel file | **SAFE** - New Supervisor Pattern |
| `src/agents/commander/index.ts` | Barrel file | **SAFE** - Legacy support |
| `src/agents/fix/index.ts` | Barrel file | **SAFE** - New Supervisor Pattern |
| `src/agents/gatherers/index.ts` | Barrel file | **SAFE** - New Supervisor Pattern |

---

## 3. Unused Exports

### src/types/state.ts (CAUTION)

| Export | Line | Type | Recommendation |
|--------|------|------|----------------|
| `FindingSchema` | 58 | Schema | May be used for validation |
| `HandoffRequestSchema` | 83 | Schema | May be used for validation |
| `FixSchema` | 119 | Schema | May be used for validation |
| `PendingAlertSchema` | 652 | Schema | May be used for validation |
| `AgentError` (type) | 149 | Type | Review - recently added for Supervisor Pattern |
| `PendingAlert` (type) | 659 | Type | Review usage |

### src/tools/factory.ts (SAFE)

| Export | Line | Recommendation |
|--------|------|----------------|
| `createBundleRegistryWithWorkspace` | 262 | **SAFE** - Consider removing if unused |

### src/tools/fix-proposal.ts (SAFE)

| Export | Line | Recommendation |
|--------|------|----------------|
| `getStoredRunbooks` | 347 | **SAFE** - Helper for testing |
| `getStoredRiskAssessments` | 373 | **SAFE** - Helper for testing |
| `createLookupRunbookTool` | 380 | **CAUTION** - May be used by Surgeon |
| `createAssessChangeRiskTool` | 519 | **CAUTION** - May be used by Surgeon |

### src/tools/hypothesis.ts (SAFE)

| Export | Line | Recommendation |
|--------|------|----------------|
| `resetChangeCorrelationStore` | 277 | **SAFE** - Test helper |
| `getStoredChangeCorrelations` | 284 | **SAFE** - Test helper |
| `createChangeCorrelationTool` | 316 | **CAUTION** - May be used by Detective |
| `resetSimilarIncidentStore` | 463 | **SAFE** - Test helper |
| `getStoredSimilarIncidents` | 470 | **SAFE** - Test helper |
| `createSimilarIncidentTool` | 508 | **CAUTION** - May be used by Detective |
| `ChangeCorrelation` (type) | 264 | **SAFE** - Type definition |
| `SimilarIncident` (type) | 443 | **SAFE** - Type definition |

### src/graph/graph.ts (SAFE - Re-exports)

These are re-exports from graph-supervisor.ts for convenience:

| Export | Line | Recommendation |
|--------|------|----------------|
| `buildSupervisorInvestigationGraph` | 35 | **SAFE** - API export |
| `compileSupervisorInvestigationGraph` | 36 | **SAFE** - API export |
| `resumeSupervisorInvestigation` | 37 | **SAFE** - API export |
| `runSupervisorInvestigation` | 38 | **SAFE** - API export |
| `supervisorInvestigationGraph` | 39 | **SAFE** - API export |

### src/graph/nodes/pre-gathering/clone.ts (NEW - Supervisor Pattern)

| Export | Line | Recommendation |
|--------|------|----------------|
| `shouldCloneRepo` | 53 | **SAFE** - Used by cloneIfNeededNode |
| `getWorkspacePath` | 217 | **SAFE** - Utility |
| `cloneRepository` | 228 | **SAFE** - Core function |
| `cleanupWorkspace` | 268 | **SAFE** - Utility |
| `cleanupOldWorkspaces` | 286 | **SAFE** - Maintenance utility |

### src/graph/nodes/supervisor.ts (NEW - Supervisor Pattern)

| Export | Line | Recommendation |
|--------|------|----------------|
| `hasObservabilityIntegration` | 40 | **SAFE** - Used in routing |
| `hasCodeIntegration` | 52 | **SAFE** - Used in routing |
| `getNextPhase` | 292 | **SAFE** - Phase transition logic |

### src/graph/graph-supervisor.ts (NEW - Supervisor Pattern)

All exports are intentional API surface:

| Export | Line | Recommendation |
|--------|------|----------------|
| `buildSupervisorInvestigationGraph` | 282 | **SAFE** - Main builder |
| `compileSupervisorInvestigationGraph` | 347 | **SAFE** - Compile with checkpointer |
| `runSupervisorInvestigation` | 369 | **SAFE** - Main entry point |
| `resumeSupervisorInvestigation` | 396 | **SAFE** - Resume capability |
| `supervisorInvestigationGraph` | 421 | **SAFE** - LangGraph Studio export |

---

## 4. Eval Scenario Exports (SAFE - Test Data)

Many eval scenarios are exported but may only be used in specific test runs:

- `evals/scenarios/code-bugs.scenarios.ts`: undefinedAccess, logicBug, nullPointerExceptionScenario
- `evals/scenarios/config-issues.scenarios.ts`: missingEnvVar, featureFlagIssue, sslConfigIssue, etc.
- `evals/scenarios/infrastructure.scenarios.ts`: networkPartition, loadBalancerIssue, etc.
- `evals/scenarios/index.ts`: scenariosByCategory, getFullEvalScenarios, getRandomScenarios
- `evals/evaluators/trajectory.evaluator.ts`: EXPECTED_*_TRAJECTORY constants
- `evals/mocks/index.ts`: Various mock creation functions

**Recommendation**: Keep all eval exports - they are intentional test data.

---

## 5. Safe Deletions Proposed

### Files to Remove

None - all unused files are barrel exports or test fixtures that should be kept for organization.

### Exports to Remove (Low Priority)

1. **`src/tools/factory.ts:createBundleRegistryWithWorkspace`** - Appears truly unused
2. **`evals/setup/seed-integrations.ts:cleanupTestIntegrations`** - Test helper, may be unused

---

## 6. Action Items

### Immediate (SAFE) - Verified Unused

| Item | Type | Risk | Status |
|------|------|------|--------|
| `@langchain/community` | Dependency | LOW | ✅ Verified unused - no imports found |

### Keep (Dev Tools)

| Item | Type | Reason |
|------|------|--------|
| `@vitest/coverage-v8` | Dev Dep | Coverage reports |
| `tsx` | Dev Dep | TypeScript execution |
| `@langchain/langgraph-cli` | Dev Dep | LangGraph Studio |
| `agentevals` | Dev Dep | Evaluation framework |

### Low Priority (After Testing)

1. [ ] `createBundleRegistryWithWorkspace` in factory.ts - Consider removing
2. [ ] `cleanupTestIntegrations` in seed-integrations.ts - Test utility, keep

### DO NOT DELETE

- Any files in `src/agents/` (both legacy and new Supervisor Pattern)
- Any files in `src/graph/` (core graph logic)
- Any eval files (test infrastructure)
- Barrel exports (index.ts files)

---

## Verification Commands

Before any deletion, run:

```bash
# Type check
pnpm typecheck

# Build
pnpm build

# Run tests (if available)
pnpm test
```

---

## Conclusion

The codebase is relatively clean. The main finding is:

1. **`@langchain/community`** - Unused production dependency, safe to remove

Most "unused" exports are intentional:
- Zod schemas for validation
- Test utilities and fixtures
- New Supervisor Pattern exports (recently added)
- Legacy DeepAgents code (kept for backward compatibility)

**No files should be deleted** - the unused file reports are primarily barrel exports (index.ts) that provide clean import paths.
