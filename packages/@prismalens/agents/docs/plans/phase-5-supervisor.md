# Phase 5: Supervisor + Streaming + Consumer Migration

## Sub-Phase Status

| Phase | Status | Commit | Scope |
|-------|--------|--------|-------|
| **5A** | COMPLETE | `8a30fe0` | Supervisor LLM routing, full graph wiring, agent self-assessments |
| **5B** | COMPLETE | — | Real streaming stack: executor.stream() → SSE → frontend |

## Phase 5A — Supervisor LLM Routing (COMPLETE)

Full LLM routing with structured output, safety guards (iteration budget, stall detection), agent self-assessments, and deterministic first pass (scout → analyst → supervisor).

Graph topology:
```
START → scout → analyst → supervisor → {gatherer, analyst, resolver, __end__}
                          ↑              │
                          └──────────────┘ (loop edges)
```

## Phase 5B — Full Streaming Stack (COMPLETE)

### Architecture

Two execution modes, both feeding real-time events to the frontend:

```
REGULAR MODE (no BullMQ):
  Frontend ──EventSource──> API SSE (/api/investigations/:id/stream)
                              │
                       StreamRelayService
                              ↑
                  QueueService iterates executor.stream()

QUEUE MODE (BullMQ):
  Frontend ──EventSource──> API SSE (/api/investigations/:id/stream)
                              │
                       StreamRelayService
                              ↑
                  Redis pub/sub subscriber
                              ↑
                Worker iterates executor.stream()
                publishes to Redis pub/sub channel
```

### Stream Format

LangGraph native `[mode, data]` tuples forwarded as-is. No custom event types.

```
graph.stream(state, { streamMode: ["tasks", "updates", "custom"] })
    ├── "tasks": { id, name: "scout", input?, result? }    — node lifecycle (automatic)
    ├── "updates": { scout: { ... } }                       — state deltas (automatic)
    └── "custom": { type: "progress", agent, message }      — config.writer() events
```

### Implementation

| Package | Change | File |
|---------|--------|------|
| Agents | Extract `buildInitialState()`, real `stream()` yielding `StreamTuple` | `executor/investigation-executor.ts` |
| Agents | Stream tests (happy path, timeout, error, backward compat) | `__tests__/executor/stream.test.ts` |
| API | `StreamRelayService` — in-memory event bus with ring buffer | `investigations/stream-relay.service.ts` |
| API | `InvestigationStreamController` — `@Sse(":id/stream")` endpoint | `investigations/investigation-stream.controller.ts` |
| API | `QueueService` — regular mode uses `executor.stream()` via `streamAndPersist()` | `queue/queue.service.ts` |
| API | `QueueService` — queue mode subscribes to Redis pub/sub for relay | `queue/queue.service.ts` |
| Worker | `executor.stream()` + Redis pub/sub publishing | `processor.ts` |
| Frontend | `useInvestigationStream()` — SSE hook with EventSource | `hooks/use-investigation-stream.ts` |
| Frontend | `InvestigationStreamPanel` — agent strip + live event log | `investigation/InvestigationStreamPanel.tsx` |
| Frontend | Investigation detail page — SSE with polling fallback | `investigations/$id/index.tsx` |

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Forward raw `[mode, data]` tuples | LangGraph native format — no mapping layer, no staleness |
| `"tasks"` mode for node lifecycle | Automatic start/finish events per node, no custom code needed |
| No contracts changes | Stream data is self-describing. Contracts only used by REST polling. |
| Redis pub/sub for queue mode | Lightweight fire-and-forget. Worker already has Redis. |
| `StreamRelayService` with ring buffer | Single source for SSE in both modes. Late-joining clients get buffered events. |
| `execute()` unchanged (uses `graph.invoke()`) | Backward compatible. No behavior change. |
| EventSource over WebSocket | Simpler, unidirectional, auto-reconnect built in. |
| Polling fallback on SSE error | Graceful degradation via existing `useInvestigationStatus()` hook. |

---

## Phase 5C-1 — Schema Alignment + Dead Code Cleanup (COMPLETED)

Completed items:
- Removed dead `AgentName` Prisma enum (PG only)
- Added `langGraphThreadId String? @unique` to `Investigation` model
- Removed stale `Investigation` fields: `preGatheringStartedAt/CompletedAt/Quality`, `agentProgression`, `analysisMethod`
- Derived contracts enums from config SSOT (`AgentNameSchema` from `AGENT_IDS`, `RoutableAgentNameSchema` from `ROUTABLE_AGENT_IDS`)
- Removed stale `InvestigationPhaseSchema`, `GraphNodeIdSchema`, `SupervisorAgentNameSchema`
- Removed `phase` from graph state, supervisor decision schema, and all consumers
- Removed `analysisMethod` (was always `"multi-agent"` constant)
- Deleted `mapPhase()` from ProgressService, simplified `determineCurrentNode()`
- Deleted dead `InvestigationGraph.tsx` component (365 lines)
- Replaced `phase_change` stream event with `routing` event (agent + reasoning)
- Removed graph visualization schemas (only consumer was dead component)

## Phase 5C-2 — Checkpoint Persistence (DEFERRED)

Remaining items:
- Implement real `getCheckpoint()` / `getCheckpointHistory()` (currently stubs)
- Connect `@langchain/langgraph-checkpoint-postgres` to graph
- Populate `langGraphThreadId` on investigation start
- AgentExecution population from stream events or checkpoints
- Token tracking (`inputTokens`/`outputTokens`)

---

## Verification

1. `pnpm typecheck` — zero errors across ALL packages
2. `pnpm --filter @prismalens/agents test` — all 114 tests pass (including 4 stream tests)
3. **Regular mode**: Frontend connects to SSE, receives `[mode, data]` tuples, stream panel shows agent progress
4. **Queue mode**: Worker publishes to Redis pub/sub, API relays to SSE clients
5. **Fallback**: SSE error → polling kicks in with existing progress bar
6. **Late join**: SSE connection after investigation starts → buffered events replayed
