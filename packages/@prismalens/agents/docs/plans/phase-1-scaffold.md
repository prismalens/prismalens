# Phase 1: Architecture Scaffold (COMPLETED)

**Status**: COMPLETED
**Dependencies**: None
**Commit**: `94a1fb6 feat: scaffold multi-agent investigation architecture (Phase 1)`

## Goal

Establish the complete file structure, type system, state annotations, graph topology, executor, and provider interfaces for the multi-agent investigation system. All files compile and type-check but contain stub implementations.

## Architecture Overview

### Graph Topology

```
[START] -> [investigator] -> [__end__]    (Phase 1 — dummy node)

Future (Phase 2+):
[START] -> [scout] -> [supervisor] -> {gatherer, analyst, resolver} -> [supervisor] -> ... -> [__end__]
```

Phase 1 uses a single `investigator` dummy node. Subsequent phases progressively replace it with the full multi-agent graph.

### Communication Pattern

- **Supervisor** uses `Command({ goto, update })` for routing (not conditional edges)
- **Subgraphs** (analyst, resolver) share state channels with parent by name matching
- **Credentials** flow via `RunnableConfig.configurable`, never in graph state

## File Structure Created

```
packages/@prismalens/agents/
├── src/
│   ├── index.ts                              # Package entry point
│   ├── agents/
│   │   ├── index.ts                          # Re-exports
│   │   ├── scout/
│   │   │   └── index.ts                      # Scout node (stub)
│   │   ├── supervisor/
│   │   │   ├── index.ts                      # Re-exports
│   │   │   ├── node.ts                       # Supervisor node + helpers
│   │   │   └── prompt.ts                     # System prompt templates
│   │   ├── gatherer/
│   │   │   ├── index.ts                      # Gatherer node (stub)
│   │   │   ├── state.ts                      # GathererStateAnnotation
│   │   │   └── prompt.ts                     # Gatherer prompt template
│   │   ├── analyst/
│   │   │   ├── index.ts                      # Re-exports
│   │   │   ├── graph.ts                      # Analyst subgraph (stub)
│   │   │   ├── state.ts                      # AnalystStateAnnotation
│   │   │   ├── prompt.ts                     # Analyst prompt template
│   │   │   └── nodes/
│   │   │       ├── form-hypotheses.ts        # Hypothesis formation (stub)
│   │   │       ├── evaluate-evidence.ts      # Evidence evaluation (stub)
│   │   │       ├── aggregate-results.ts      # Deterministic ranking (stub)
│   │   │       ├── challenge.ts              # Contradiction search (stub)
│   │   │       └── confidence-check.ts       # Confidence scoring (stub)
│   │   └── resolver/
│   │       ├── index.ts                      # Re-exports
│   │       ├── graph.ts                      # Resolver subgraph (stub)
│   │       ├── state.ts                      # ResolverStateAnnotation
│   │       ├── prompt.ts                     # Resolver prompt template
│   │       └── nodes/
│   │           ├── lookup-precedent.ts       # Precedent search (stub)
│   │           ├── plan-fix.ts               # Fix proposal (stub)
│   │           ├── assess-risk.ts            # Risk assessment (stub)
│   │           └── approval-gate.ts          # Human-in-the-loop (stub)
│   ├── executor/
│   │   ├── index.ts                          # Re-exports
│   │   └── investigation-executor.ts         # InvestigationExecutor class
│   ├── graph/
│   │   ├── index.ts                          # Re-exports
│   │   ├── investigation-graph.ts            # buildInvestigationGraph + Studio entry
│   │   ├── nodes.ts                          # Dummy investigator node
│   │   └── state.ts                          # InvestigationStateAnnotation
│   ├── llm/
│   │   ├── index.ts                          # Re-exports
│   │   └── factory.ts                        # createLLM() — 6 providers
│   ├── providers/
│   │   ├── index.ts                          # Re-exports
│   │   └── data-provider.ts                  # DataProvider interface + StubDataProvider
│   ├── tools/
│   │   ├── index.ts                          # Re-exports
│   │   ├── registry.ts                       # ToolRegistry class (stub)
│   │   ├── schemas.ts                        # Zod schemas for structured output
│   │   ├── types.ts                          # Skill, ToolBundle, ToolCategory types
│   │   ├── skills/
│   │   │   ├── index.ts                      # loadSkills() (stub)
│   │   │   ├── log.ts                        # search_logs tool (stub)
│   │   │   ├── code.ts                       # search_code tool (stub)
│   │   │   ├── change.ts                     # get_recent_changes tool (stub)
│   │   │   └── precedent.ts                  # search_precedents tool (stub)
│   │   ├── analyst/
│   │   │   ├── search-similar-incidents.ts   # RAG-based search (stub)
│   │   │   ├── query-gathered-data.ts        # State search (stub)
│   │   │   └── retrieve-postmortems.ts       # Past investigation lookup (stub)
│   │   ├── resolver/
│   │   │   ├── search-runbooks.ts            # Runbook/service metadata search (stub)
│   │   │   └── lookup-past-resolutions.ts    # Past resolution lookup (stub)
│   │   └── mcp/
│   │       ├── index.ts                      # Re-exports
│   │       ├── client.ts                     # MCPClientManager (stub)
│   │       └── converter.ts                  # MCP -> LangChain converter (stub)
│   ├── types/
│   │   ├── index.ts                          # Re-exports
│   │   ├── contexts.ts                       # IncidentContext, AlertContext, IntegrationContext
│   │   ├── inputs.ts                         # InvestigationInput, InvestigationConfig, LLMProviderConfig
│   │   ├── progress.ts                       # InvestigationProgressEvent union type
│   │   ├── results.ts                        # InvestigationResult, Hypothesis, Evidence, Recommendation
│   │   └── state.ts                          # InvestigationPhase, AgentName, GatheredData, ProgressSnapshot
│   └── utils/
│       ├── index.ts                          # Re-exports
│       ├── checkpoints.ts                    # Checkpoint helpers
│       └── severity.ts                       # Severity utilities
├── langgraph.json                            # LangGraph Studio config
├── package.json                              # Dependencies
└── tsconfig.json                             # TypeScript config
```

## Key Design Decisions

### State Annotation (5-Layer)

```typescript
interface InvestigationState {
  // Layer 1: Input (minimal identifiers + config)
  investigationId: string
  incidentId: string
  config: InvestigationConfig
  integrations: IntegrationContext[]

  // Layer 2: Process control (supervisor manages via Command)
  phase: InvestigationPhase
  iterations: number
  lastProgressSnapshot: ProgressSnapshot | null
  errors: string[]

  // Layer 3: Gathered data (scout + gatherer populate)
  incident: IncidentContext | null
  alerts: AlertContext[]
  gatheredData: GatheredData

  // Layer 4: Data requests (analyst -> supervisor -> gatherer loop)
  needsMoreData: boolean
  dataGaps: string[]

  // Layer 5: Analysis results (append-only via reducers)
  hypotheses: Hypothesis[]
  recommendations: Recommendation[]
  result?: InvestigationResult
}
```

### DataProvider Injection

```typescript
interface DataProvider {
  fetchIncident(incidentId: string): Promise<IncidentContext | null>
  fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse>
  fetchSimilarIncidents?(request: SimilarIncidentRequest): Promise<SimilarIncidentResponse>
}
```

Two implementations exist outside this package:
- **DirectDataProvider** (API): Direct DB access via NestJS services
- **WorkerDataProvider** (Worker): oRPC calls to the API

### Credential Flow

Credentials never appear in graph state. They flow via `RunnableConfig.configurable`:

```typescript
const config: RunnableConfig = {
  configurable: {
    credentials: { /* decrypted integration credentials */ },
    tokenTracker: new TokenTracker(),
  }
}
```

### LangGraph Studio Integration

`langgraph.json` points to `investigationGraph()` factory function. Studio uses `StubDataProvider` and `MemorySaver` for development.

### Executor API

```typescript
class InvestigationExecutor {
  execute(input: InvestigationInput): Promise<InvestigationResult>     // Legacy sync
  stream(input, config?): AsyncGenerator<InvestigationProgressEvent>   // Phase 5: real streaming
  close(): Promise<void>
}
```

## Structured Output Schemas

All LLM calls use `withStructuredOutput(schema)`:

| Schema | Used By | Purpose |
|--------|---------|---------|
| `SupervisorDecisionSchema` | Supervisor | Routing decision (agent + phase + reasoning) |
| `HypothesisFormationSchema` | Analyst | Root cause hypothesis generation |
| `EvidenceEvaluationSchema` | Analyst | Evidence evaluation per hypothesis |
| `ChallengeResultSchema` | Analyst | Contradiction search results |
| `FixProposalSchema` | Resolver | Remediation proposals |
| `RiskAssessmentSchema` | Resolver | Risk evaluation for proposed fixes |
| `GathererSummarySchema` | Gatherer | Structured data collection summary |

## Verification (Passed)

- All files compile: `pnpm typecheck` passes
- Package exports correctly: `index.ts` re-exports all public types and classes
- Studio config valid: `langgraph.json` points to `investigationGraph` factory
- Graph executes: dummy investigator node produces a result
