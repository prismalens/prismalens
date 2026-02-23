# Phase 5: Supervisor + Streaming + Consumer Migration

**Status**: IN PROGRESS (Phase 5A)
**Dependencies**: Phase 4/4.5 (gatherer works via createDeepAgent), Phase 2 (scout works, supervisor stubs compile partial result)
**Estimated effort**: 4-5 days (largest phase)

## Sub-Phase Split

The original Phase 5 has been split into three sub-phases:

- **Phase 5A** (IN PROGRESS): Supervisor LLM routing + full graph wiring + agent self-assessments + available data sources. Agents package only.
- **Phase 5B** (PLANNED): Streaming implementation (`executor.stream()`, `config.writer()` events). Agents package only.
- **Phase 5C** (PLANNED): Consumer migration (QueueService, Worker, SSE endpoint, frontend). API + Worker + Frontend + Contracts.

The original Parts A-D below are superseded by the 5A/5B/5C split but kept as reference.

## Goal

Implement the supervisor with full LLM routing logic and deterministic guards, wire all nodes in the graph, add LangGraph streaming, migrate API and Worker consumers, and build SSE for the frontend.

## Grounding Notes (DB Schema & API Truth)

| Claim | Actual Truth Source | Status |
|-------|---------------------|--------|
| compilePartialResult implemented | Yes — `agents/src/agents/supervisor/node.ts` has `compilePartialResult()`, `detectProgress()`, `takeProgressSnapshot()` | Confirmed |
| supervisorPrompt exists | Both dynamic and static versions in `agents/src/agents/supervisor/prompt.ts` | Confirmed |
| Frontend uses SSE | **WRONG** — polling via `refetchInterval: 2000ms`. NO SSE/EventSource | Must build from scratch |
| Progress contracts exist | `getProgress` and `getProgressHistory` in contracts | Confirmed |
| ProgressService reads checkpoints | `api/src/modules/investigations/progress.service.ts` calls `getCheckpoint()`, `getStateFromCheckpoint()` | Confirmed |
| investigation-progress.ts schema is stale | References `validateIncident`, `preGather`, `detective`, `adversary`, `surgeon` | Must rewrite |
| DB AgentName enum stale | OLD names: `alert_agent`, `gatherer_agent`, etc. | Must update |
| DB AgentExecution model | `agentName: String` (not enum-constrained), `agentType: AgentType`, `inputTokens`, `outputTokens`, `executionTimeMs`, `confidence` | Confirmed |
| DB ToolExecution model | `toolName: String`, `toolCategory: ToolCategory?`, `arguments`, `result`, `executionTimeMs` | Confirmed |
| QueueService.buildExecutorInput() | Line 369 in queue.service.ts — ~100 lines of incident/alert mapping | Confirmed (to remove) |
| QueueService.persistResults() | Line 548 — calls `investigationsService.setResult()` | Confirmed |
| Worker writes results | `writeResultWithRelations()` — atomic transaction | Confirmed |
| Checkpoint storage backends | Only `MemorySaver` installed. No persistent backend | Must add dependency |

## Part A: Supervisor LLM Routing

### Step 1: Full Supervisor Node Implementation

**Modify**: `agents/src/agents/supervisor/node.ts`

```typescript
export async function supervisorNode(
  state: InvestigationState,
  config: RunnableConfig,
): Promise<Command> {
  const maxIterations = state.config.maxIterations ?? 8

  // --- Guard 1: Hard budget (deterministic) ---
  if (state.iterations >= maxIterations) {
    return new Command({
      update: { result: compilePartialResult(state), phase: "completed" },
      goto: "__end__",
    })
  }

  // --- Guard 2: Progress stall detection ---
  const { stalled, reason } = detectProgress(state)
  if (stalled) {
    config.writer?.({ type: "stalled", reason })
    return new Command({
      update: { result: compilePartialResult(state), phase: "completed" },
      goto: "__end__",
    })
  }

  // --- Guard 3: Token budget ---
  const tokenTracker = config.configurable?.tokenTracker
  const maxBudget = state.config.maxTokenBudget ?? 50_000
  if (tokenTracker?.isOverBudget(maxBudget)) {
    return new Command({
      update: { result: compilePartialResult(state), phase: "completed" },
      goto: "__end__",
    })
  }

  // --- Guard 4: Context rot check ---
  // If data is stale and < 4 iterations, refresh via scout
  // If stale and >= 4, compile with staleness warning

  // --- LLM Routing Decision ---
  const llm = createLLM(state.config.llm)
  const structuredLlm = llm.withStructuredOutput(SupervisorDecisionSchema)

  const stateContext = formatStateForSupervisor(state)
  const prompt = supervisorPrompt({
    incidentTitle: state.incident?.title ?? "Unknown",
    severity: state.incident?.severity ?? "medium",
    phase: state.phase,
  })

  const decision = await structuredLlm.invoke([
    { role: "system", content: prompt },
    { role: "user", content: stateContext },
  ])

  // --- Deterministic Ordering Guards (override LLM if needed) ---

  // Guard A: Analyst requires non-empty sourcesWithData
  if (decision.agent === "analyst") {
    const sources = state.gatheredData?.coverage?.sourcesWithData ?? []
    if (sources.length === 0) {
      decision.agent = "gatherer"
      decision.reasoning = "Redirected: analyst requires gathered data"
    }
  }

  // Guard B: Resolver requires hypotheses OR high-confidence similar incident
  if (decision.agent === "resolver") {
    const hasHypotheses = state.hypotheses.length > 0
    const hasSimilar = hasHighConfidenceSimilarIncident(state)
    if (!hasHypotheses && !hasSimilar) {
      decision.agent = "analyst"
      decision.reasoning = "Redirected: resolver requires hypotheses"
    }
  }

  // --- Determine phase from routing ---
  const phaseMap: Record<string, InvestigationPhase> = {
    gatherer: "gathering",
    analyst: "analysis",
    resolver: "resolution",
    __end__: "completed",
  }
  const nextPhase = phaseMap[decision.agent] ?? state.phase

  // --- Emit progress event ---
  config.writer?.({
    type: "phase_change",
    from: state.phase,
    to: nextPhase,
  })

  // --- Compile result if ending ---
  const update: Partial<InvestigationState> = {
    phase: nextPhase,
    iterations: state.iterations + 1,
    lastProgressSnapshot: takeProgressSnapshot(state),
  }

  if (decision.agent === "__end__") {
    update.result = compilePartialResult(state)
  }

  return new Command({
    update,
    goto: decision.agent,
  })
}
```

### Step 2: Format State for Supervisor LLM

**Create**: `agents/src/agents/supervisor/format.ts`

```typescript
export function formatStateForSupervisor(state: InvestigationState): string {
  const sections: string[] = []

  // Incident summary
  sections.push(`## Incident: ${state.incident?.title ?? "Unknown"}`)
  sections.push(`Severity: ${state.incident?.severity}, Status: ${state.incident?.status}`)
  sections.push(`Service: ${state.incident?.serviceName ?? "unknown"}`)

  // Data coverage
  const coverage = state.gatheredData?.coverage
  if (coverage) {
    sections.push(`\n## Data Coverage`)
    sections.push(`Sources with data: ${coverage.sourcesWithData.join(", ") || "none"}`)
    sections.push(`Data gaps: ${coverage.dataGaps.join(", ") || "none"}`)
  }

  // Hypotheses
  if (state.hypotheses.length > 0) {
    sections.push(`\n## Hypotheses (${state.hypotheses.length})`)
    for (const h of state.hypotheses) {
      sections.push(`- [${(h.confidence * 100).toFixed(0)}%] ${h.description}`)
    }
  }

  // Recommendations
  if (state.recommendations.length > 0) {
    sections.push(`\n## Recommendations (${state.recommendations.length})`)
    for (const r of state.recommendations) {
      sections.push(`- [${r.priority}] ${r.title}`)
    }
  }

  // Process state
  sections.push(`\n## Process State`)
  sections.push(`Phase: ${state.phase}, Iteration: ${state.iterations}/${state.config.maxIterations ?? 8}`)
  sections.push(`Needs more data: ${state.needsMoreData}`)

  return sections.join("\n")
}
```

### Step 3: Implement hasHighConfidenceSimilarIncident

**Modify**: `agents/src/agents/supervisor/node.ts`

Replace the stub:

```typescript
export function hasHighConfidenceSimilarIncident(state: InvestigationState): boolean {
  const similar = state.gatheredData?.similarIncidents as SimilarIncidentMatch[] | undefined
  if (!similar || similar.length === 0) return false
  return similar.some(s => s.similarity > 0.8)
}
```

## Part B: Full Graph Wiring

### Step 4: Wire All Nodes with Command Routing

**Modify**: `agents/src/graph/investigation-graph.ts`

```typescript
export function buildInvestigationGraph(deps: InvestigationGraphDeps) {
  const { checkpointer, dataProvider, integrations, mcpTools } = deps

  const graph = new StateGraph(InvestigationStateAnnotation)
    .addNode("scout", createScoutNode(dataProvider))
    .addNode("supervisor", supervisorNode, {
      ends: ["gatherer", "analyst", "resolver", "__end__"],
    })
    .addNode("gatherer", createGathererNode(integrations, mcpTools ?? []))
    .addNode("analyst", createAnalystGraph())
    .addNode("resolver", createResolverGraph())
    .addEdge(START, "scout")
    .addEdge("scout", "supervisor")
    .addEdge("gatherer", "supervisor")
    .addEdge("analyst", "supervisor")
    .addEdge("resolver", "supervisor")

  return graph.compile({ checkpointer })
}
```

Note: `createAnalystGraph()` and `createResolverGraph()` may still be stubs at this point if Phases 6-7 aren't complete. The graph compiles either way.

## Part C: Streaming Implementation

### Step 5: Rewrite executor.stream()

**Modify**: `agents/src/executor/investigation-executor.ts`

```typescript
async *stream(
  input: InvestigationInput,
  config?: RunnableConfig,
): AsyncGenerator<InvestigationProgressEvent> {
  const startTime = Date.now()
  const initialState = this.buildInitialState(input)

  try {
    for await (const [mode, chunk] of await this.graph.stream(
      initialState,
      {
        ...config,
        streamMode: ["updates", "custom"],
      },
    )) {
      if (mode === "updates") {
        const nodeName = Object.keys(chunk)[0]
        yield {
          type: "node_complete",
          node: nodeName,
          updates: chunk[nodeName],
        }
      } else if (mode === "custom") {
        yield chunk as InvestigationProgressEvent
      }
    }

    // Get final state for completed event
    const finalState = await this.graph.getState(config)
    const result = finalState.values.result ?? compilePartialResult(finalState.values)
    result.executionTimeMs = Date.now() - startTime

    yield { type: "completed", result }
  } catch (error) {
    yield {
      type: "completed",
      result: {
        investigationId: input.investigationId,
        status: "failed",
        summary: null,
        rootCause: null,
        rootCauseCategory: null,
        confidence: null,
        hypotheses: [],
        recommendations: [],
        error: (error as Error).message,
        executionTimeMs: Date.now() - startTime,
        analysisMethod: null,
      },
    }
  }
}
```

### Step 6: Custom Progress Emitting in Nodes

Use `config.writer()` in nodes to emit progress events:

```typescript
// In scout node
config.writer?.({ type: "progress", agent: "scout", message: "Fetching incident data..." })

// In supervisor node
config.writer?.({ type: "phase_change", from: state.phase, to: nextPhase })

// In gatherer (inside tool calls)
config.writer?.({ type: "progress", agent: "gatherer", message: "Searching logs..." })
```

These events appear in the `"custom"` stream mode.

## Part D: Consumer Migration

### Step 7: Migrate QueueService (Regular Mode)

**Modify**: `api/src/infrastructure/queue/queue.service.ts`

Major changes:
1. **Remove `buildExecutorInput()`** (~100 lines at line 369) — scout handles data fetching via DataProvider
2. **Remove `persistResults()`** (line 548) — streaming handles result persistence
3. **Use `executor.stream()` instead of `executor.execute()`**
4. **Resolve credentials** via `CredentialsService.decrypt()` -> pass in `RunnableConfig.configurable`

```typescript
// Before (old pattern)
const input = await this.buildExecutorInput(jobData)
const result = await executor.execute(input)
await this.persistResults(investigation, result)

// After (new pattern)
const config: RunnableConfig = {
  configurable: {
    credentials: await this.credentialsService.decryptForIntegrations(jobData.integrationIds),
    tokenTracker: new TokenTracker(),
  },
}

const input: InvestigationInput = {
  investigationId: jobData.investigationId,
  incidentId: jobData.incidentId,
  config: { llm: jobData.llmConfig, maxIterations: jobData.maxIterations },
  integrations: jobData.integrations,
}

for await (const event of executor.stream(input, config)) {
  // Relay progress events (for SSE consumers)
  this.progressRelay.emit(jobData.investigationId, event)

  if (event.type === "completed") {
    await this.investigationsService.setResult(investigation, event.result)
  }
}
```

### Step 8: Migrate Worker Processor (Queue Mode)

**Modify**: `worker/src/processor.ts`

Similar changes:
1. **Remove `buildExecutorInput()`** — scout handles data fetching via `WorkerDataProvider`
2. **Use `executor.stream()`**, relay events to `job.updateProgress()`
3. Credentials already fetched via internal API with `PRISMALENS_INTERNAL_SECRET` header -> pass in `RunnableConfig`
4. Result writing: continue using `api.investigations.writeResult()` (triggers atomic `writeResultWithRelations()`)

```typescript
for await (const event of executor.stream(input, config)) {
  await job.updateProgress(event)

  if (event.type === "completed") {
    await api.investigations.writeResult(event.result)
  }
}
```

### Step 9: SSE Endpoint + Frontend Migration

**Create**: `api/src/modules/investigations/investigation-stream.controller.ts`

```typescript
@Controller("api/investigations")
export class InvestigationStreamController {
  @Get(":id/stream")
  @Sse()
  stream(@Param("id") id: string): Observable<MessageEvent> {
    return new Observable(subscriber => {
      // Regular mode: direct stream from executor
      // Queue mode: poll BullMQ job.progress -> relay as SSE events
      const handler = (event: InvestigationProgressEvent) => {
        subscriber.next({ data: JSON.stringify(event) })
        if (event.type === "completed") subscriber.complete()
      }

      this.progressRelay.on(id, handler)
      return () => this.progressRelay.off(id, handler)
    })
  }
}
```

**Modify**: `frontend/src/lib/api/hooks/use-investigations-orpc.ts`

Replace `useInvestigationProgress()` polling with SSE:

```typescript
export function useInvestigationStream(investigationId: string) {
  const [events, setEvents] = useState<InvestigationProgressEvent[]>([])
  const [status, setStatus] = useState<"connecting" | "streaming" | "completed" | "error">("connecting")

  useEffect(() => {
    const source = new EventSource(`/api/investigations/${investigationId}/stream`)

    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data)
      setEvents(prev => [...prev, parsed])
      setStatus("streaming")
      if (parsed.type === "completed") {
        setStatus("completed")
        source.close()
      }
    }

    source.onerror = () => setStatus("error")
    return () => source.close()
  }, [investigationId])

  return { events, status, latestEvent: events[events.length - 1] }
}
```

Keep polling as fallback for browsers without SSE support.

**Modify**: `contracts/src/contracts/investigations.ts`

Add stream contract for SSE endpoint.

**Modify**: `contracts/src/schemas/investigation-progress.ts`

**Full rewrite**: Replace stale schema that references `validateIncident`, `preGather`, `detective`, `adversary`, `surgeon` with actual agent names (`scout`, `gatherer`, `analyst`, `resolver`, `supervisor`) and phases (`pre_gathering`, `gathering`, `analysis`, `resolution`, `completed`).

### Step 9b: DB Schema Update for Agent Names

Update stale DB `AgentName` enum values:
- `alert_agent` -> `scout`
- `gatherer_agent` -> `gatherer`
- `analyzer_agent` -> `analyst`
- `recommender_agent` -> `resolver`
- `log_retriever_agent` -> remove

Note: `AgentExecution.agentName` is `String` (not enum-constrained) so no data migration needed, but enum update keeps schema consistent.

### Step 10: Checkpoint Storage

**Add dependency**: `@langchain/langgraph-checkpoint-postgres`

- Production: Use PostgresSaver with 24h TTL on checkpoints
- Dev: MemorySaver (ephemeral, no TTL needed)
- Add cleanup job for expired checkpoints

```typescript
// In graph builder
const checkpointer = process.env.NODE_ENV === "production"
  ? new PostgresSaver({ connectionString: process.env.DATABASE_URL })
  : new MemorySaver()
```

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/src/agents/supervisor/node.ts` | Full LLM routing with guards |
| Create | `agents/src/agents/supervisor/format.ts` | formatStateForSupervisor() |
| Modify | `agents/src/graph/investigation-graph.ts` | Wire all 5 nodes |
| Modify | `agents/src/executor/investigation-executor.ts` | Stream-based API with dual mode |
| Modify | `api/src/infrastructure/queue/queue.service.ts` | Consumer migration |
| Modify | `worker/src/processor.ts` | Consumer migration |
| Create | `api/src/modules/investigations/investigation-stream.controller.ts` | SSE endpoint |
| Modify | `contracts/src/schemas/investigation-progress.ts` | Full rewrite |
| Modify | `contracts/src/contracts/investigations.ts` | Add stream contract |
| Modify | `frontend/src/lib/api/hooks/use-investigations-orpc.ts` | Replace polling with SSE |
| Modify | `database/prisma/pg/schema/app.prisma` | Update AgentName enum values |
| Add dep | `@langchain/langgraph-checkpoint-postgres` | Production checkpoint storage |

## Tests

### Supervisor Routing Tests

**Create**: `agents/src/__tests__/supervisor/routing.test.ts`

- Mock LLM -> verify correct routing decisions for each scenario
- Guard tests: analyst blocked without gathered data -> redirected to gatherer
- Guard tests: resolver blocked without hypotheses -> redirected to analyst
- Budget guard: over budget -> compile and end
- Stall detection: no progress -> compile and end

### Stream Integration Tests

**Create**: `agents/src/__tests__/executor/stream.test.ts`

- Full graph with StubDataProvider + mock LLM -> collect events -> verify completed event
- Progress events emitted via config.writer()
- Phase change events emitted correctly
- Error handling: graph failure -> completed event with error

### Consumer Integration Tests

- QueueService: verify stream consumption + result persistence
- Worker: verify stream consumption + job.updateProgress()
- SSE endpoint: verify events relayed to EventSource client

## Verification

1. `pnpm typecheck` passes across all packages
2. `pnpm test` passes
3. Full graph execution with StubDataProvider + mock LLM
4. Supervisor routes: scout -> gatherer -> analyst -> end (basic happy path)
5. Stream emits progress events (node_complete, progress, phase_change, completed)
6. QueueService and Worker use new stream API
7. SSE endpoint returns events to browser
8. Frontend receives real-time progress via EventSource
9. Checkpoint persistence works with PostgresSaver in production mode
