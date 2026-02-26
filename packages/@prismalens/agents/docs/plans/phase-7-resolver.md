# Phase 7: Resolver Subgraph

> **REEVALUATION NEEDED (Phase 4.5 Decision)**
>
> The resolver will become a `createDeepAgent` node (decided during Phase 4.5 deep agent migration).
> Shared infrastructure from the gatherer implementation will be reused:
> - `createDeepAgentConfig("resolver")` for skill sources + backend + middleware
> - `ToolGatingMiddleware` for progressive tool disclosure
> - `skills/resolver/` directory for resolver-specific SKILL.md files (resolution playbooks, scaling, rollback)
>
> **Key questions to resolve after gatherer deep agent is working:**
> - Replace `interrupt()` (graph-level pause) with deep agent HITL middleware (agent-loop pause)? Different UX and state semantics.
> - How does the built-in `humanInTheLoopMiddleware` from deepagents interact with LangGraph's `interrupt()`?
> - Performance impact of deep agent overhead on resolver nodes.
> - Backend for generating fix scripts — use `FilesystemBackend` write capabilities?

**Status**: COMPLETED
**Dependencies**: Phase 5 (supervisor routes to resolver), Phase 6 (analyst produces hypotheses)
**Estimated effort**: 2-3 days

## Goal

Implement evidence-based remediation with precedent lookup and human-in-the-loop approval gates. The resolver searches for past resolutions and runbooks, proposes fixes grounded in precedent, assesses risk, and gates high-risk actions for human approval.

## Grounding Notes (DB Schema & API Truth)

| Claim | Actual Truth Source | Status |
|-------|---------------------|--------|
| Runbook models exist | **NO Runbook models** in DB. "Runbook search" = `Service.metadata` JSON or external systems | Correction: rename to "precedent search" |
| Recommendation is a DB model | Yes — linked to `Investigation` via `investigationId` FK | Confirmed |
| Recommendation DB fields | `type`, `priority` (RecommendationPriority), `title`, `description`, `estimatedImpact?`, `estimatedEffort?`, `category` (RecommendationCategory), `relatedHypothesisId?` | Confirmed |
| Agent Recommendation type mismatch | Agent: `type: "immediate"\|"short_term"\|"long_term"`, DB: `category: RecommendationCategory`. Must reconcile | Must align (Phase 0.5) |
| Past resolutions queryable | `Investigation` table with `status: completed`, `rootCause`, `rootCauseCategory`, `summary`. Joinable with `Recommendation[]` and `Incident` | Confirmed |
| interrupt() requires checkpointer | LangGraph `interrupt()` requires persistent checkpointer (Phase 5 adds PostgresSaver) | Phase 5 dependency |

## Existing Stubs (from Phase 1)

### Subgraph Topology
```
START -> lookup_precedent -> plan_fix -> assess_risk -> approval_gate -> END
```

### State Annotation
```typescript
// agents/src/agents/resolver/state.ts
ResolverStateAnnotation:
  recommendations: Recommendation[]     // shared with parent (concat reducer)
  hypotheses: Hypothesis[]              // read from parent (concat reducer)
  gatheredData: GatheredData            // read from parent
  precedentResults: unknown[]           // internal (concat reducer)
  riskAssessments: unknown[]            // internal (concat reducer)
```

### Structured Output Schemas (from Phase 1)
- `FixProposalSchema` — category: `code_fix | config_change | rollback | infrastructure | escalation`
- `RiskAssessmentSchema` — riskLevel, blastRadius, reversibility, requiresApproval

## Step 1: Implement lookup_precedent Node

**Modify**: `agents/src/agents/resolver/nodes/lookup-precedent.ts`

```typescript
export async function lookupPrecedent(
  state: ResolverState,
  config: RunnableConfig,
): Promise<Partial<ResolverState>> {
  const results: PrecedentResult[] = []

  // 1. Search runbooks via Service.metadata
  const runbookResults = await searchRunbooks(state, config)
  results.push(...runbookResults)

  // 2. Lookup past resolutions from Investigation table
  const resolutionResults = await lookupPastResolutions(state, config)
  results.push(...resolutionResults)

  config.writer?.({
    type: "progress",
    agent: "resolver",
    message: `Found ${results.length} precedent results`,
  })

  return { precedentResults: results }
}
```

**Tools used**: `searchRunbooks`, `lookupPastResolutions`

**Input**: Confirmed hypotheses (root cause category) + affected service

## Step 2: Implement plan_fix Node

**Modify**: `agents/src/agents/resolver/nodes/plan-fix.ts`

```typescript
export async function planFix(
  state: ResolverState,
  config: RunnableConfig,
): Promise<Partial<ResolverState>> {
  const llm = createLLM(config.configurable?.llmConfig)
  const structuredLlm = llm.withStructuredOutput(FixProposalSchema)

  // Format context for LLM
  const hypothesesContext = state.hypotheses
    .filter(h => h.confidence > 0.3)
    .map(h => `- [${(h.confidence * 100).toFixed(0)}%] ${h.description} (${h.category})`)
    .join("\n")

  const precedentContext = state.precedentResults
    .map((p: any) => `- ${p.title}: ${p.summary} (source: ${p.source})`)
    .join("\n")

  const result = await structuredLlm.invoke([
    { role: "system", content: RESOLVER_FIX_PROMPT },
    {
      role: "user",
      content: `## Root Cause Hypotheses\n${hypothesesContext}\n\n## Precedent\n${precedentContext || "No precedent found"}\n\n## Current System State\n${formatGatheredDataSummary(state.gatheredData)}`,
    },
  ])

  // Convert to Recommendation[] with IDs
  const recommendations: Recommendation[] = result.recommendations.map((r, i) => ({
    id: `r-${Date.now()}-${i}`,
    urgency: r.urgency,                    // was "type" in old schema
    priority: r.priority,
    title: r.title,
    description: r.description,
    steps: r.steps,
    estimatedImpact: undefined,
    estimatedEffort: undefined,
    tags: [r.precedentBased ? "historical" : "novel"],
    relatedHypothesisId: state.hypotheses[0]?.id,
  }))

  config.writer?.({
    type: "progress",
    agent: "resolver",
    message: `Proposed ${recommendations.length} remediation steps`,
  })

  // Emit recommendation events
  for (const r of recommendations) {
    config.writer?.({
      type: "recommendation_added",
      title: r.title,
      priority: r.priority,
    })
  }

  return { recommendations }
}
```

**Tags**: `historical` (grounded in precedent, higher confidence) vs `novel` (new approach, needs more scrutiny).

## Step 3: Implement assess_risk Node

**Modify**: `agents/src/agents/resolver/nodes/assess-risk.ts`

```typescript
export async function assessRisk(
  state: ResolverState,
  config: RunnableConfig,
): Promise<Partial<ResolverState>> {
  if (state.recommendations.length === 0) return {}

  const llm = createLLM(config.configurable?.llmConfig)
  const structuredLlm = llm.withStructuredOutput(RiskAssessmentSchema)

  const recommendationsSummary = state.recommendations
    .map(r => `- [${r.priority}] ${r.title}: ${r.description}`)
    .join("\n")

  const result = await structuredLlm.invoke([
    { role: "system", content: RESOLVER_RISK_PROMPT },
    {
      role: "user",
      content: `## Proposed Recommendations\n${recommendationsSummary}\n\n## System Context\n${formatGatheredDataSummary(state.gatheredData)}`,
    },
  ])

  config.writer?.({
    type: "progress",
    agent: "resolver",
    message: `Assessed risk for ${result.assessments.length} recommendations`,
  })

  return { riskAssessments: result.assessments }
}
```

**Evaluates**: risk level, blast radius, reversibility, requiresApproval flag.

## Step 4: Implement approval_gate Node

**Modify**: `agents/src/agents/resolver/nodes/approval-gate.ts`

```typescript
import { interrupt } from "@langchain/langgraph"

export async function approvalGate(
  state: ResolverState,
  config: RunnableConfig,
): Promise<Partial<ResolverState>> {
  const highRiskAssessments = (state.riskAssessments as RiskAssessment[])
    .filter(a => a.requiresApproval)

  // Low risk: pass through all recommendations
  if (highRiskAssessments.length === 0) {
    return { recommendations: state.recommendations }
  }

  // High risk: interrupt for human approval
  const approval = interrupt({
    type: "approval_required",
    recommendations: state.recommendations,
    riskAssessments: state.riskAssessments,
    highRiskItems: highRiskAssessments.map(a => a.recommendationTitle),
  })

  // After human resumes: filter based on approval
  if (approval?.approved) {
    const approvedTitles = new Set(approval.approved as string[])
    const filtered = state.recommendations.filter(r => approvedTitles.has(r.title))
    return { recommendations: filtered }
  }

  // If all rejected, return empty recommendations
  return { recommendations: [] }
}
```

**Behavior**:
- Low risk: Pass through all recommendations -> END
- High risk: Call `interrupt()` -> pause graph execution -> wait for human to resume
- After human resumes: Filter to only approved recommendations, discard rejected

**Important**: `interrupt()` requires a checkpointer on the graph (PostgresSaver from Phase 5). Without a checkpointer, `interrupt()` will throw.

## Step 5: Implement Resolver Tools

### search-runbooks

**Modify**: `agents/src/tools/resolver/search-runbooks.ts`

No Runbook models in DB. This tool searches two sources:

```typescript
export const searchRunbooks = tool(
  async (input, config: RunnableConfig) => {
    const results: RunbookResult[] = []

    // Source 1: Service.metadata JSON (may contain { runbook: "url" })
    const dataProvider = config.configurable?.dataProvider
    if (dataProvider) {
      // Fetch service metadata via DataProvider
      // Service model has metadata: Json? field
      const serviceRunbook = await fetchServiceRunbook(dataProvider, input.serviceId)
      if (serviceRunbook) results.push(serviceRunbook)
    }

    // Source 2: External systems via knowledge_base integrations
    const integrations = config.configurable?.integrations ?? []
    const kbIntegration = integrations.find(
      (i: IntegrationContext) => i.type === "confluence" || i.type === "notion"
    )
    if (kbIntegration) {
      const kbResults = await searchKnowledgeBase(kbIntegration, input.query, config)
      results.push(...kbResults)
    }

    return JSON.stringify({ runbooks: results })
  },
  {
    name: "search_runbooks",
    description: "Search for runbooks in service metadata and knowledge base integrations",
    schema: SearchRunbooksSchema,
  }
)
```

### lookup-past-resolutions

**Modify**: `agents/src/tools/resolver/lookup-past-resolutions.ts`

```typescript
export const lookupPastResolutions = tool(
  async (input, config: RunnableConfig) => {
    const dataProvider = config.configurable?.dataProvider
    if (!dataProvider?.fetchPreviousInvestigation) {
      return JSON.stringify({ resolutions: [] })
    }

    // Query Investigation table:
    // WHERE status = 'completed' AND rootCause IS NOT NULL
    // Filter by rootCauseCategory matching current hypothesis
    // Filter by incident.serviceId matching current service
    const result = await dataProvider.fetchPreviousInvestigation(input.incidentId)

    // Return: summary, rootCause, rootCauseCategory, confidence, dataSourcesUsed
    // Join with Recommendation[] to get past resolution steps
    // Join with Incident for timeToResolve and severity context
    return JSON.stringify({
      resolutions: result ? [{
        investigationId: result.investigationId,
        summary: result.summary,
        rootCause: result.rootCause,
        rootCauseCategory: result.rootCauseCategory,
        hypotheses: result.hypotheses,
        recommendations: result.recommendations,
      }] : [],
    })
  },
  {
    name: "lookup_past_resolutions",
    description: "Find how similar past incidents were resolved",
    schema: LookupPastResolutionsSchema,
  }
)
```

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/src/agents/resolver/nodes/lookup-precedent.ts` | Tool-based precedent search |
| Modify | `agents/src/agents/resolver/nodes/plan-fix.ts` | LLM fix proposal |
| Modify | `agents/src/agents/resolver/nodes/assess-risk.ts` | LLM risk assessment |
| Modify | `agents/src/agents/resolver/nodes/approval-gate.ts` | Deterministic + interrupt |
| Modify | `agents/src/agents/resolver/graph.ts` | Wire subgraph nodes |
| Modify | `agents/src/tools/resolver/search-runbooks.ts` | Real runbook search |
| Modify | `agents/src/tools/resolver/lookup-past-resolutions.ts` | Real resolution lookup |

## Tests

### Unit Tests

**Create**: `agents/src/__tests__/resolver/lookup-precedent.test.ts`
- Mock tools -> verify precedent collection from both sources
- No precedent found -> empty array

**Create**: `agents/src/__tests__/resolver/plan-fix.test.ts`
- Mock LLM -> verify recommendations with proper fields
- Verify `historical` vs `novel` tags
- Verify `relatedHypothesisId` linked correctly

**Create**: `agents/src/__tests__/resolver/assess-risk.test.ts`
- Mock LLM -> verify risk assessment fields for each recommendation
- Verify `requiresApproval` flag set for high-risk

**Create**: `agents/src/__tests__/resolver/approval-gate.test.ts`
- No high-risk -> pass through all recommendations
- High-risk -> interrupt called (verify interrupt payload)
- After approval: only approved recommendations returned
- All rejected: empty recommendations

### Integration Test

**Create**: `agents/src/__tests__/resolver/subgraph.test.ts`
- Full subgraph execution with mock LLM and sample hypotheses
- End-to-end: hypotheses in -> recommendations out
- Low-risk path: no interrupt
- High-risk path: interrupt + resume with approval

## Verification

1. `pnpm typecheck` passes
2. `pnpm test` passes
3. Resolver subgraph runs in isolation with mock data
4. Produces recommendations grounded in precedent
5. Historical recommendations tagged correctly
6. High-risk actions trigger `interrupt()` with correct payload
7. Resuming with approval includes only approved recommendations
8. Resuming with rejection returns empty recommendations
9. `interrupt()` works with PostgresSaver checkpointer (Phase 5)
