# Phase 2: Scout + Type Alignment + ADRs

**Status**: PLANNED
**Dependencies**: Phase 0.5 (enum sync)
**Estimated effort**: 2-3 days

## Goal

Implement the scout node as a pure function (no LLM) that fetches incident data via DataProvider, enriches it with timeline analysis and service topology hints, and produces a coverage report. Also fix structural type gaps and document 8 architectural decision records.

## Prerequisites

Phase 0.5 must be complete so that:
- Agent types import from contracts (not hardcoded literals)
- Enum values like `Severity`, `AlertStatus`, `IncidentStatus` are dynamic
- Stale contracts schema (`investigation-progress.ts`) has been rewritten

## Part 0: Schema Grounding

These items fix structural gaps not covered by Phase 0.5 (which handles enums only).

### 0.1 Add `resolvedAt` to IncidentContext

**Modify**: `agents/src/types/contexts.ts`

```typescript
export interface IncidentContext {
  // ... existing fields
  resolvedAt?: string  // ISO string — both consumers use .toISOString()
}
```

Both `DirectDataProvider` and `WorkerDataProvider` already map `resolvedAt` from the DB model. The agent type was missing it.

### 0.2 Add `fetchChangeEvents` to DataProvider

**Modify**: `agents/src/providers/data-provider.ts`

```typescript
export interface ChangeEventContext {
  id: string
  type: string
  source: string
  description: string
  timestamp: string
  serviceId?: string
  metadata?: Record<string, unknown>
}

export interface DataProvider {
  fetchIncident(incidentId: string): Promise<IncidentContext | null>
  fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse>
  fetchSimilarIncidents?(request: SimilarIncidentRequest): Promise<SimilarIncidentResponse>
  fetchChangeEvents?(incidentId: string, timeRange?: { start: string; end: string }): Promise<ChangeEventContext[]>
}
```

Optional method — `StubDataProvider` returns `[]`. Real implementations query the `ChangeEvent` model.

### 0.3 Fix DirectDataProvider mapping gaps

The API's DirectDataProvider needs to map the new optional methods. This is a consumer-side change (in `api/` package), documented here for completeness.

## Part A: Scout Implementation (9 Steps)

### Step 1: Scout Enrichment Types

**Create**: `agents/src/agents/scout/types.ts`

```typescript
export interface AlertTimeline {
  firstAlert: string       // ISO timestamp
  latestAlert: string      // ISO timestamp
  durationMs: number
  alertsPerMinute: number
  escalationPattern: "stable" | "escalating" | "intermittent"
}

export interface ServiceTopologyHint {
  primaryService: string
  relatedServices: string[]
  upstreamDependencies: string[]
  downstreamDependencies: string[]
}

export interface SeverityEscalation {
  initialSeverity: string
  currentSeverity: string
  escalated: boolean
  escalationTime?: string
}

export interface ScoutCoverageReport {
  incidentFetched: boolean
  alertCount: number
  changeEventCount: number
  similarIncidentCount: number
  timeline: AlertTimeline | null
  topology: ServiceTopologyHint | null
  escalation: SeverityEscalation | null
  sourcesQueried: string[]
  sourcesWithData: string[]
  dataGaps: string[]
}
```

### Step 2: Pure Enrichment Functions

**Create**: `agents/src/agents/scout/enrichments.ts`

```typescript
export function computeAlertTimeline(alerts: AlertContext[]): AlertTimeline | null
export function extractServiceTopology(incident: IncidentContext, alerts: AlertContext[]): ServiceTopologyHint | null
export function computeSeverityEscalation(alerts: AlertContext[]): SeverityEscalation | null
```

These are pure functions — no LLM, no external calls. Computable from alert timestamps, severity fields, and service IDs.

### Step 3: Coverage Report Builder

**Create**: `agents/src/agents/scout/coverage.ts`

```typescript
export function buildCoverageReport(
  incident: IncidentContext | null,
  alerts: AlertContext[],
  changeEvents: ChangeEventContext[],
  similarIncidents: SimilarIncidentMatch[],
  timeline: AlertTimeline | null,
  topology: ServiceTopologyHint | null,
  escalation: SeverityEscalation | null,
): ScoutCoverageReport
```

Computes `sourcesQueried`, `sourcesWithData`, and `dataGaps` from what was fetched.

### Step 4: safeFetch Utility

**Create**: `agents/src/utils/safe-fetch.ts`

```typescript
export async function safeFetch<T>(
  fn: () => Promise<T>,
  fallback: T,
  label: string,
): Promise<{ data: T; success: boolean; error?: string }>
```

Wraps DataProvider calls so a single fetch failure doesn't crash the scout. Used in every DataProvider call within the scout node.

### Step 5: Scout Node Implementation

**Modify**: `agents/src/agents/scout/index.ts`

```typescript
export function createScoutNode(dataProvider: DataProvider) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    // 1. Parallel fetch: incident + alerts + changeEvents + similarIncidents
    const [incident, alertsRes, changeEvents, similar] = await Promise.all([
      safeFetch(() => dataProvider.fetchIncident(state.incidentId), null, "incident"),
      safeFetch(() => dataProvider.fetchAlerts({ incidentId: state.incidentId }), { alerts: [], hasMore: false }, "alerts"),
      safeFetch(() => dataProvider.fetchChangeEvents?.(state.incidentId) ?? Promise.resolve([]), [], "changeEvents"),
      safeFetch(() => dataProvider.fetchSimilarIncidents?.({ incidentId: state.incidentId }) ?? Promise.resolve({ incidents: [] }), { incidents: [] }, "similar"),
    ])

    // 2. Compute enrichments (pure functions, no external calls)
    const timeline = computeAlertTimeline(alertsRes.data.alerts)
    const topology = extractServiceTopology(incident.data, alertsRes.data.alerts)
    const escalation = computeSeverityEscalation(alertsRes.data.alerts)

    // 3. Build coverage report
    const coverage = buildCoverageReport(
      incident.data, alertsRes.data.alerts, changeEvents.data,
      similar.data.incidents, timeline, topology, escalation,
    )

    // 4. Build gatheredData with initial data
    const gatheredData: GatheredData = {
      ...(state.gatheredData ?? {}),
      coverage: {
        sourcesQueried: coverage.sourcesQueried,
        sourcesWithData: coverage.sourcesWithData,
        temporalOverlap: timeline !== null,
        dataGaps: coverage.dataGaps,
      },
    }

    // 5. Collect errors from failed fetches
    const errors = [incident, alertsRes, changeEvents, similar]
      .filter(r => !r.success)
      .map(r => r.error!)

    return {
      incident: incident.data,
      alerts: alertsRes.data.alerts,
      gatheredData,
      phase: "pre_gathering" as const,
      errors,
    }
  }
}
```

### Step 6: GatheredData Extensions

**Modify**: `agents/src/types/state.ts`

Add optional fields to `GatheredData`:

```typescript
export interface GatheredData {
  logs?: unknown[]
  commits?: unknown[]
  deployments?: unknown[]
  metrics?: unknown[]
  codeSearchResults?: unknown[]
  changeEvents?: unknown[]         // NEW
  similarIncidents?: unknown[]     // NEW
  coverage?: DataCoverage
}
```

### Step 7: Wire Scout -> Supervisor in Graph

**Modify**: `agents/src/graph/investigation-graph.ts`

Replace the dummy `investigator` node with:

```typescript
const graph = new StateGraph(InvestigationStateAnnotation)
  .addNode("scout", createScoutNode(deps.dataProvider))
  .addNode("supervisor", supervisorNode)
  .addEdge("__start__", "scout")
  .addEdge("scout", "supervisor")
  .addEdge("supervisor", "__end__")  // Phase 2: supervisor stub -> __end__
```

### Step 8: AbortSignal Timeout in Executor

**Modify**: `agents/src/executor/investigation-executor.ts`

Add investigation-level timeout:

```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), input.config.timeout ?? 300_000) // 5min default
try {
  const finalState = await this.graph.invoke(initialState, { signal: controller.signal })
  ...
} finally {
  clearTimeout(timeout)
}
```

### Step 9: Tests

**Create**: `agents/src/__tests__/scout/enrichments.test.ts`

- `computeAlertTimeline`: empty alerts, single alert, escalating pattern, stable pattern
- `extractServiceTopology`: no service, single service, multiple services
- `computeSeverityEscalation`: no escalation, escalation detected

**Create**: `agents/src/__tests__/scout/coverage.test.ts`

- `buildCoverageReport`: all sources available, partial sources, no sources

**Create**: `agents/src/__tests__/scout/scout-node.test.ts`

- Integration test: mock DataProvider, verify scout returns correct state updates
- Error handling: one fetch fails, others succeed — scout continues

## Part B: Architectural Decision Records (ADRs)

### ADR-1: Alert Grouping Strategy

**Decision**: Keep current 4-tier correlation architecture.

**Enhancement**: Add configurable time windows (currently hardcoded 60min) and alert storm limiting.

**Current tiers**:
1. Rule-based: exact fingerprint match
2. Service-based: same service, time window
3. Source-based: same source/monitor
4. LLM-based: semantic similarity

**Future**: Add Tier 2.5 (topology-based cross-service correlation using `ServiceDependency` model).

### ADR-2: Investigation Re-triggering

**Decision**: NOTIFY strategy — when a new alert arrives for an in-progress investigation, add it to the investigation context without restarting.

**Implementation**: `InvestigationTriggerService` already checks for active investigations. Enhancement: supervisor checks for new alerts when making routing decisions.

### ADR-3: Context Rot

**Decision**: Timestamp freshness check on gathered data. Deferred enforcement — log warnings but don't block investigation.

**Implementation**: `isDataStale(gatheredData, maxAgeMs)` utility. Supervisor checks on each iteration. If data is stale and < 4 iterations, route to scout for refresh.

### ADR-4: Budget/Cost Control

**Decision**: Token budget tracking per investigation. Deferred to Phase 3 (TokenTracker utility).

**Defaults**: 50K tokens for cloud LLMs, unlimited for Ollama.

### ADR-5: Timeout Handling

**Decision**: Two-level timeout system.

1. **Investigation-level**: AbortSignal in executor (default 5min). Triggers `compilePartialResult()`.
2. **Per-node**: `withTimeout()` wrapper (default 60s per node). Individual node failure doesn't crash investigation.

### ADR-6: Concurrent Investigations

**Decision**: Current design is correct — no changes needed.

Multiple investigations run independently with separate graph instances, separate state, separate checkpoints. BullMQ handles queue concurrency.

### ADR-7: Graceful Degradation

**Decision**: `safeFetch()` pattern for all external data fetches.

Every DataProvider call is wrapped in `safeFetch()`. On failure: log error, return fallback, add to `errors[]` in state. Investigation continues with available data.

### ADR-8: Observability

**Decision**: Structured logging now, full streaming later.

Phase 2: Structured log events from scout node.
Phase 5: Real LangGraph streaming with `["updates", "custom"]` modes + SSE endpoint.

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `agents/src/agents/scout/types.ts` | Scout enrichment types |
| Create | `agents/src/agents/scout/enrichments.ts` | Pure enrichment functions |
| Create | `agents/src/agents/scout/coverage.ts` | Coverage report builder |
| Create | `agents/src/utils/safe-fetch.ts` | Graceful degradation utility |
| Modify | `agents/src/agents/scout/index.ts` | Full scout node implementation |
| Modify | `agents/src/types/state.ts` | Add changeEvents, similarIncidents to GatheredData |
| Modify | `agents/src/types/contexts.ts` | Add resolvedAt to IncidentContext |
| Modify | `agents/src/providers/data-provider.ts` | Add fetchChangeEvents?, ChangeEventContext |
| Modify | `agents/src/graph/investigation-graph.ts` | Wire scout -> supervisor |
| Modify | `agents/src/executor/investigation-executor.ts` | AbortSignal timeout |
| Create | `agents/src/__tests__/scout/enrichments.test.ts` | Enrichment function tests |
| Create | `agents/src/__tests__/scout/coverage.test.ts` | Coverage report tests |
| Create | `agents/src/__tests__/scout/scout-node.test.ts` | Scout integration test |
| Add dep | `vitest` to agents `devDependencies` | Test framework |

## Tests

- **Enrichment functions** (unit): computeAlertTimeline, extractServiceTopology, computeSeverityEscalation — pure functions with edge cases
- **Coverage report** (unit): buildCoverageReport with various data availability scenarios
- **safeFetch** (unit): success case, error case, timeout case
- **Scout node** (integration): mock DataProvider, verify state updates, error accumulation

## Verification

1. `pnpm typecheck` passes
2. `pnpm test` passes (vitest added)
3. Graph: `START -> scout -> supervisor(stub) -> __end__` produces correct result
4. Scout populates `gatheredData.coverage` with real source tracking
5. Failed DataProvider calls don't crash the investigation
6. Investigation-level timeout triggers `compilePartialResult()`
