# Phase 3: Skills/Tools Integration

**Status**: PLANNED
**Dependencies**: Phase 2 (scout populates gatheredData.coverage so tools know what's available)
**Estimated effort**: 3-4 days

## Goal

Wire skill stub implementations to real data sources. Make tools actually call external APIs (Loki, GitHub, Datadog, etc.) using credentials from `RunnableConfig.configurable`. Implement token budget tracking and the `ToolRegistry.getToolsForAgent()` method.

## Grounding Notes (DB Schema & API Truth)

| Claim | Actual Truth Source | Status |
|-------|---------------------|--------|
| Skill providers need credentials | `IntegrationConnection.credentials` is AES-256-GCM encrypted (`CredentialsService`) | Correct |
| Provider resolution from integrations | `IntegrationsService.getIntegrationsByConnectionIds()` exists (line 858) | Existing API |
| Git provider factory exists | `createGitProvider(providerName)` in API handles GitHub/GitLab | Existing API |
| IntegrationCategory is an enum | **WRONG** — it's a `String` field on `IntegrationDefinition.category` | Correction |
| ChangeEventsService exists | **WRONG** — `ChangeEvent` model exists but NO service | Must create |
| Precedent searches runbooks | **NO Runbook models** — precedent = query `Investigation` table | Correction |
| Token tracking aligns with DB | DB `AgentExecution` has `inputTokens: Int?`, `outputTokens: Int?` | Align |
| ServiceDependency for Tier 2.5 | Model exists with `dependencyType` and `criticality`. Currently unused | Confirmed |
| DB ToolCategory enum | Values: `file`, `search`, `github`, `logs`, `analysis` | Align tool names |

## Step 1: Skill Provider Architecture

Create provider-specific implementations behind each skill's abstract interface.

**New directory**: `agents/src/tools/skills/providers/`

```
src/tools/skills/providers/
├── log/
│   ├── index.ts          # LogProvider interface
│   ├── loki.ts           # Grafana Loki implementation
│   └── datadog.ts        # Datadog Logs implementation
├── code/
│   ├── index.ts          # CodeProvider interface
│   ├── github.ts         # GitHub search + file content
│   └── gitlab.ts         # GitLab search + file content
├── change/
│   ├── index.ts          # ChangeProvider interface
│   ├── github.ts         # GitHub commits/PRs
│   └── render.ts         # Render deployments
└── precedent/
    ├── index.ts          # PrecedentProvider interface
    └── internal.ts       # Search PrismaLens DB (Investigation table + IncidentSimilarity model)
```

### Provider Interface Pattern

Each skill category has a common interface:

```typescript
// tools/skills/providers/log/index.ts
export interface LogProvider {
  name: string
  search(query: string, timeRange: { start: string; end: string }, credentials: Record<string, unknown>): Promise<LogSearchResult>
  getContext?(logId: string, credentials: Record<string, unknown>): Promise<LogContext>
}

export interface LogSearchResult {
  entries: LogEntry[]
  totalCount: number
  truncated: boolean
}

export interface LogEntry {
  timestamp: string
  level: string
  message: string
  labels?: Record<string, string>
  source?: string
}
```

### Provider Selection

Providers are selected based on `IntegrationContext.type`:

```typescript
function resolveLogProvider(integrations: IntegrationContext[]): LogProvider | null {
  const logIntegration = integrations.find(i =>
    i.type === "loki" || i.type === "datadog" || i.type === "elasticsearch"
  )
  if (!logIntegration) return null

  switch (logIntegration.type) {
    case "loki": return new LokiProvider(logIntegration.config)
    case "datadog": return new DatadogProvider(logIntegration.config)
    default: return null
  }
}
```

## Step 2: Wire Skills to Providers

Each skill tool resolves its provider from `RunnableConfig.configurable`:

**Modify**: `agents/src/tools/skills/log.ts`

```typescript
import { tool } from "@langchain/core/tools"
import type { RunnableConfig } from "@langchain/core/runnables"
import { resolveLogProvider } from "./providers/log/index.js"

export const searchLogs = tool(
  async (input, config: RunnableConfig) => {
    const integrations = config.configurable?.integrations ?? []
    const credentials = config.configurable?.credentials ?? {}
    const provider = resolveLogProvider(integrations)

    if (!provider) {
      return JSON.stringify({ error: "No log provider configured", entries: [] })
    }

    const result = await provider.search(input.query, input.timeRange, credentials)
    return JSON.stringify(result)
  },
  {
    name: "search_logs",
    description: "Search application logs for errors, patterns, and anomalies",
    schema: SearchLogsSchema,
  }
)
```

Same pattern for `code.ts`, `change.ts`, `precedent.ts`.

## Step 3: Token Budget Tracking

**Modify**: `agents/src/types/inputs.ts`

```typescript
export interface InvestigationConfig {
  llm: LLMProviderConfig
  maxIterations?: number
  timeout?: number
  maxTokenBudget?: number  // NEW — default: 50000 for cloud, unlimited for Ollama
}
```

**Create**: `agents/src/utils/token-tracker.ts`

```typescript
export class TokenTracker {
  private inputTokens = 0
  private outputTokens = 0
  private callCount = 0

  track(input: number, output: number): void {
    this.inputTokens += input
    this.outputTokens += output
    this.callCount += 1
  }

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens
  }

  get summary(): TokenSummary {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      callCount: this.callCount,
    }
  }

  isOverBudget(budget: number): boolean {
    return this.totalTokens >= budget
  }
}

export interface TokenSummary {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  callCount: number
}
```

Usage: passed via `config.configurable.tokenTracker`. Supervisor reads `tokenTracker.totalTokens` before routing to LLM agents.

## Step 4: ToolRegistry.getToolsForAgent()

**Modify**: `agents/src/tools/registry.ts`

Implement the stub method:

```typescript
const AGENT_TOOL_MAP: Record<string, ToolCategory[]> = {
  gatherer: ["log", "code", "change", "precedent", "mcp"],
  analyst: ["analyst"],
  resolver: ["resolver"],
}

getToolsForAgent(agentName: string, categories?: ToolCategory[]): StructuredToolInterface[] {
  const allowedCategories = categories ?? AGENT_TOOL_MAP[agentName] ?? []

  const skillTools = this.skills
    .filter(s => allowedCategories.includes(s.category))
    .flatMap(s => s.tools)

  const bundleTools = Array.from(this.bundles.values())
    .filter(b => allowedCategories.includes(b.category))
    .flatMap(b => b.tools)

  return [...skillTools, ...bundleTools]
}
```

Also implement `loadFromIntegrations()`:

```typescript
loadFromIntegrations(integrations: IntegrationContext[]): void {
  const skills = loadSkills(integrations)
  this.skills = skills
}
```

## Step 5: Context Reuse on Re-investigation

**Modify**: `agents/src/providers/data-provider.ts`

```typescript
export interface PreviousInvestigationContext {
  investigationId: string
  summary: string | null
  rootCause: string | null
  rootCauseCategory: string | null
  hypotheses: Array<{ description: string; confidence: number; category?: string }>
  recommendations: Array<{ title: string; description: string }>
}

export interface DataProvider {
  // ... existing methods
  fetchPreviousInvestigation?(incidentId: string): Promise<PreviousInvestigationContext | null>
}
```

Scout calls this during initial fetch if investigation is a re-trigger:
```typescript
const previous = await safeFetch(
  () => dataProvider.fetchPreviousInvestigation?.(state.incidentId) ?? Promise.resolve(null),
  null,
  "previousInvestigation"
)
```

Avoids repeating work already done in prior investigation.

## Step 6: Topology-based Cross-Service Correlation (Tier 2.5)

**Modify**: `api/src/modules/correlation/correlation.service.ts`

Add Tier 2.5 between service-based (Tier 2) and source-based (Tier 3):

```typescript
// Tier 2.5: Check ServiceDependency for related services with open incidents
async function checkDependencyCorrelation(alert: Alert, existingIncidents: Incident[]): Promise<Incident | null> {
  const deps = await prisma.serviceDependency.findMany({
    where: {
      OR: [
        { serviceId: alert.serviceId },
        { dependsOnId: alert.serviceId },
      ],
    },
  })

  // Check if any dependency's service has an open incident
  const depServiceIds = deps.map(d => d.serviceId === alert.serviceId ? d.dependsOnId : d.serviceId)

  return existingIncidents.find(inc =>
    depServiceIds.includes(inc.serviceId) &&
    inc.status !== "resolved" && inc.status !== "closed"
  ) ?? null
}
```

This catches cascading failures (e.g., API alerts correlate with DB incident because API depends on DB).

## Step 7: Create ChangeEventsService (API Package)

The `ChangeEvent` model exists in the Prisma schema but has no service implementation.

**Create**: `api/src/modules/change-events/change-events.service.ts`

```typescript
@Injectable()
export class ChangeEventsService {
  constructor(private prisma: PrismaService) {}

  async findByIncident(incidentId: string, timeRange?: { start: Date; end: Date }): Promise<ChangeEvent[]> {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } })
    if (!incident) return []

    return this.prisma.changeEvent.findMany({
      where: {
        serviceId: incident.serviceId,
        timestamp: timeRange ? { gte: timeRange.start, lte: timeRange.end } : undefined,
      },
      orderBy: { timestamp: "desc" },
    })
  }
}
```

**Create**: `api/src/modules/change-events/change-events.module.ts`

```typescript
@Module({
  providers: [ChangeEventsService],
  exports: [ChangeEventsService],
})
export class ChangeEventsModule {}
```

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `agents/src/tools/skills/providers/log/index.ts` | LogProvider interface |
| Create | `agents/src/tools/skills/providers/log/loki.ts` | Loki implementation |
| Create | `agents/src/tools/skills/providers/log/datadog.ts` | Datadog implementation |
| Create | `agents/src/tools/skills/providers/code/index.ts` | CodeProvider interface |
| Create | `agents/src/tools/skills/providers/code/github.ts` | GitHub implementation |
| Create | `agents/src/tools/skills/providers/change/index.ts` | ChangeProvider interface |
| Create | `agents/src/tools/skills/providers/change/github.ts` | GitHub commits/PRs |
| Create | `agents/src/tools/skills/providers/change/render.ts` | Render deployments |
| Create | `agents/src/tools/skills/providers/precedent/index.ts` | PrecedentProvider interface |
| Create | `agents/src/tools/skills/providers/precedent/internal.ts` | Query Investigation table |
| Create | `api/src/modules/change-events/change-events.service.ts` | ChangeEventsService |
| Create | `api/src/modules/change-events/change-events.module.ts` | NestJS module |
| Modify | `agents/src/tools/skills/log.ts` | Wire to LogProvider |
| Modify | `agents/src/tools/skills/code.ts` | Wire to CodeProvider |
| Modify | `agents/src/tools/skills/change.ts` | Wire to ChangeProvider |
| Modify | `agents/src/tools/skills/precedent.ts` | Wire to PrecedentProvider |
| Modify | `agents/src/tools/registry.ts` | Implement getToolsForAgent() + loadFromIntegrations() |
| Modify | `agents/src/types/inputs.ts` | Add maxTokenBudget to InvestigationConfig |
| Create | `agents/src/utils/token-tracker.ts` | Token budget tracking utility |
| Modify | `agents/src/providers/data-provider.ts` | Add fetchPreviousInvestigation?() |
| Modify | `api/src/modules/correlation/correlation.service.ts` | Tier 2.5 cross-service |

## Tests

### Unit Tests
- Each provider implementation: mock HTTP responses, verify structured output
- TokenTracker: track, isOverBudget, summary
- ToolRegistry.getToolsForAgent(): verify correct tool scoping per agent
- Provider resolution: correct provider selected based on integration type

### Integration Tests
- `loadSkills(integrations)` -> resolve providers -> tool calls return structured data
- With `StubDataProvider`: tools return mock data (no external calls)

## Verification

1. `pnpm typecheck` passes (agents + api packages)
2. `pnpm test` passes
3. With `StubDataProvider`: tools return mock data (no external calls needed)
4. With real integrations: tools call external APIs and return structured results
5. ToolRegistry returns correct tools for each agent name
6. TokenTracker accurately tracks cumulative token usage
7. ChangeEventsService queries DB correctly
