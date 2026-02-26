# Phase 6: Analyst Subgraph

> **REEVALUATION NEEDED (Phase 4.5 Decision)**
>
> The analyst will become a `createDeepAgent` node (decided during Phase 4.5 deep agent migration).
> Shared infrastructure from the gatherer implementation will be reused:
> - `createDeepAgentConfig("analyst")` for skill sources + backend + middleware
> - `ToolGatingMiddleware` for progressive tool disclosure
> - `skills/analyst/` directory for analyst-specific SKILL.md files
>
> **Key questions to resolve after gatherer deep agent is working:**
> - Does the analyst deep agent REPLACE the 5-node subgraph, or is it the entry node?
> - How does `Send()` parallelism interact with deep agent middleware?
> - Each analyst node uses `llm.withStructuredOutput()` (not tool-calling). Is a deep agent the right pattern for structured-output-only nodes?
> - Performance impact of deep agent overhead on nodes that run multiple times per investigation.

**Status**: COMPLETED
**Dependencies**: Phase 5 (supervisor routes to analyst when data is gathered)
**Estimated effort**: 3-4 days

## Goal

Implement hypothesis-driven investigation with parallel evidence evaluation. The analyst subgraph generates competing root cause hypotheses, evaluates evidence for/against each one in parallel, challenges top hypotheses for contradictions, and produces confidence-scored results.

## Grounding Notes (DB Schema & API Truth)

| Claim | Actual Truth Source | Status |
|-------|---------------------|--------|
| IncidentSimilarity for RAG | Model exists: `incidentId`, `similarIncidentId`, `similarityScore` (0-100), `matchFactors` (JSON) | Confirmed |
| Investigation has rootCause | `Investigation.rootCause: String?`, `Investigation.rootCauseCategory: RootCauseCategory?` | Confirmed |
| Investigation has summary | `Investigation.summary: String?` | Confirmed |
| Hypothesis category alignment | Agent `Hypothesis.category` should map to DB `RootCauseCategory` (code, config, infrastructure, external, unknown) via `mapHypothesisCategoryToDb()` | Must use mapping |
| Vector stores for RAG | **NONE installed** — similar incident search is keyword-based (query Investigation table) or uses pre-computed `IncidentSimilarity` scores | Design constraint |
| Postmortem model | **NO dedicated model** — "postmortems" = `Investigation` records with `status: completed`, `rootCause` filled | Correction |

## Existing Stubs (from Phase 1)

### Subgraph Topology
```
START -> form_hypotheses -> evaluate_evidence -> aggregate_results -> challenge -> confidence_check -> END
```

### State Annotation
```typescript
// agents/src/agents/analyst/state.ts
AnalystStateAnnotation:
  hypotheses: Hypothesis[]          // shared with parent (concat reducer)
  needsMoreData: boolean            // shared with parent
  dataGaps: string[]                // shared with parent
  gatheredData: GatheredData        // read from parent
  workingHypotheses: Hypothesis[]   // internal (concat reducer)
  challengeResults: unknown[]       // internal (concat reducer)
```

### Structured Output Schemas (from Phase 1)
- `HypothesisFormationSchema` — category: `code_bug | config_change | infrastructure | dependency | deployment | unknown`
- `EvidenceEvaluationSchema` — supporting/contradicting evidence with strength
- `ChallengeResultSchema` — contradictions with severity

## Step 1: Implement form_hypotheses Node

**Modify**: `agents/src/agents/analyst/nodes/form-hypotheses.ts`

```typescript
export async function formHypotheses(
  state: AnalystState,
  config: RunnableConfig,
): Promise<Partial<AnalystState>> {
  const llm = createLLM(config.configurable?.llmConfig)
  const structuredLlm = llm.withStructuredOutput(HypothesisFormationSchema)

  // Optionally use searchSimilarIncidents for RAG context (past incidents as priors)
  let precedentContext = ""
  if (state.gatheredData?.similarIncidents?.length) {
    precedentContext = `\n## Similar Past Incidents\n${
      state.gatheredData.similarIncidents
        .map((s: any) => `- ${s.title} (similarity: ${s.similarity}): ${s.rootCause ?? "unknown root cause"}`)
        .join("\n")
    }`
  }

  const result = await structuredLlm.invoke([
    { role: "system", content: ANALYST_HYPOTHESIS_PROMPT },
    { role: "user", content: formatGatheredDataForAnalyst(state.gatheredData) + precedentContext },
  ])

  // Convert to Hypothesis[] with IDs
  const hypotheses: Hypothesis[] = result.hypotheses.map((h, i) => ({
    id: `h-${Date.now()}-${i}`,
    description: h.description,
    confidence: h.initialConfidence,
    evidence: [],
    category: h.category,
    reasoning: `Expected evidence: ${h.expectedEvidence.join(", ")}`,
  }))

  config.writer?.({
    type: "progress",
    agent: "analyst",
    message: `Formed ${hypotheses.length} hypotheses`,
  })

  return { workingHypotheses: hypotheses }
}
```

**Key design**: Generates 2-4 competing hypotheses per investigation. Uses gathered data + similar incidents as context for the LLM.

## Step 2: Implement Parallel Evaluation with Send()

**Modify**: `agents/src/agents/analyst/graph.ts`

Replace direct edge `form_hypotheses -> evaluate_evidence` with conditional edges using `Send()`:

```typescript
import { StateGraph, Send, START, END } from "@langchain/langgraph"

const analystGraph = new StateGraph(AnalystStateAnnotation)
  .addNode("form_hypotheses", formHypotheses)
  .addNode("evaluate_evidence", evaluateEvidence)
  .addNode("aggregate_results", aggregateResults)
  .addNode("challenge", challenge)
  .addNode("confidence_check", confidenceCheck)
  .addEdge(START, "form_hypotheses")
  .addConditionalEdges("form_hypotheses", (state) => {
    // Fan out: one evaluation per hypothesis
    return state.workingHypotheses.map(h =>
      new Send("evaluate_evidence", {
        ...state,
        currentHypothesis: h,  // Each invocation gets a single hypothesis
      })
    )
  })
  .addEdge("evaluate_evidence", "aggregate_results")
  .addEdge("aggregate_results", "challenge")
  .addEdge("challenge", "confidence_check")
  .addEdge("confidence_check", END)
```

Each hypothesis gets its own `evaluate_evidence` invocation running in parallel. Results converge at `aggregate_results`.

**Note**: Need to add `currentHypothesis: Annotation<Hypothesis | null>()` to `AnalystStateAnnotation` for the Send pattern.

## Step 3: Implement evaluate_evidence Node

**Modify**: `agents/src/agents/analyst/nodes/evaluate-evidence.ts`

```typescript
export async function evaluateEvidence(
  state: AnalystState & { currentHypothesis?: Hypothesis },
  config: RunnableConfig,
): Promise<Partial<AnalystState>> {
  const hypothesis = state.currentHypothesis
  if (!hypothesis) return {}

  const llm = createLLM(config.configurable?.llmConfig)
  const structuredLlm = llm.withStructuredOutput(EvidenceEvaluationSchema)

  const result = await structuredLlm.invoke([
    { role: "system", content: ANALYST_EVIDENCE_PROMPT },
    {
      role: "user",
      content: `## Hypothesis: ${hypothesis.description}\n\n${formatGatheredDataForEvidence(state.gatheredData)}`,
    },
  ])

  // Update hypothesis with evaluation results
  const updatedHypothesis: Hypothesis = {
    ...hypothesis,
    confidence: result.updatedConfidence,
    evidence: [
      ...result.supportingEvidence.map(e => ({
        type: "other" as const,
        description: `[SUPPORTING ${e.strength}] ${e.description}`,
        source: "analyst_evaluation",
      })),
      ...result.contradictingEvidence.map(e => ({
        type: "other" as const,
        description: `[CONTRADICTING ${e.strength}] ${e.description}`,
        source: "analyst_evaluation",
      })),
    ],
  }

  return {
    workingHypotheses: [updatedHypothesis],
    needsMoreData: result.needsMoreData,
    dataGaps: result.dataGaps ?? [],
  }
}
```

**Input**: Single hypothesis + gatheredData
**Output**: Supporting/contradicting evidence, updated confidence, needsMoreData flag

## Step 4: Implement aggregate_results Node

**Modify**: `agents/src/agents/analyst/nodes/aggregate-results.ts`

**Deterministic** (no LLM):

```typescript
export function aggregateResults(state: AnalystState): Partial<AnalystState> {
  // Score each hypothesis based on evidence
  const scored = state.workingHypotheses.map(h => {
    const supporting = h.evidence.filter(e => e.description.includes("[SUPPORTING"))
    const contradicting = h.evidence.filter(e => e.description.includes("[CONTRADICTING"))

    const score =
      supporting.filter(e => e.description.includes("strong")).length * 3 +
      supporting.filter(e => e.description.includes("moderate")).length * 2 +
      supporting.filter(e => e.description.includes("weak")).length * 1 -
      contradicting.length * 2

    return { hypothesis: h, score }
  })

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Eliminate hypotheses with confidence < 0.1
  const viable = scored
    .filter(s => s.hypothesis.confidence >= 0.1)
    .map(s => s.hypothesis)

  return { workingHypotheses: viable }
}
```

**Scoring formula**: `(strong * 3 + moderate * 2 + weak * 1) - (contradicting * 2)`

## Step 5: Implement challenge Node

**Modify**: `agents/src/agents/analyst/nodes/challenge.ts`

```typescript
export async function challenge(
  state: AnalystState,
  config: RunnableConfig,
): Promise<Partial<AnalystState>> {
  if (state.workingHypotheses.length === 0) return {}

  const llm = createLLM(config.configurable?.llmConfig)
  const structuredLlm = llm.withStructuredOutput(ChallengeResultSchema)

  // Present top hypotheses and ask LLM to find contradictions
  const hypothesesSummary = state.workingHypotheses
    .map(h => `- [${(h.confidence * 100).toFixed(0)}%] ${h.description}`)
    .join("\n")

  const result = await structuredLlm.invoke([
    { role: "system", content: ANALYST_CHALLENGE_PROMPT },
    {
      role: "user",
      content: `## Hypotheses\n${hypothesesSummary}\n\n## Available Data\n${formatGatheredDataForEvidence(state.gatheredData)}`,
    },
  ])

  // Apply confidence adjustments
  const adjustedHypotheses = state.workingHypotheses.map(h => {
    const adjustment = result.confidenceAdjustments.find(
      a => a.hypothesisTitle === h.description
    )
    return adjustment
      ? { ...h, confidence: Math.max(0, Math.min(1, h.confidence + adjustment.adjustment)) }
      : h
  })

  config.writer?.({
    type: "progress",
    agent: "analyst",
    message: `Found ${result.contradictions.length} contradictions`,
  })

  return {
    workingHypotheses: adjustedHypotheses,
    challengeResults: result.contradictions,
  }
}
```

**Goal**: Anti-confirmation-bias. Actively searches for evidence that contradicts the top hypotheses.

## Step 6: Implement confidence_check Node

**Modify**: `agents/src/agents/analyst/nodes/confidence-check.ts`

**Deterministic** (no LLM):

```typescript
export function confidenceCheck(state: AnalystState): Partial<AnalystState> {
  const topHypotheses = state.workingHypotheses
    .sort((a, b) => b.confidence - a.confidence)

  if (topHypotheses.length === 0) {
    return {
      hypotheses: [],
      needsMoreData: true,
      dataGaps: ["No viable hypotheses formed — need more data"],
    }
  }

  const best = topHypotheses[0]

  // HIGH confidence (>0.7): Promote to shared hypotheses -> supervisor routes forward
  if (best.confidence > 0.7) {
    return {
      hypotheses: topHypotheses.filter(h => h.confidence > 0.3),
      needsMoreData: false,
    }
  }

  // LOW confidence + verifiable gaps: Request more data
  if (state.dataGaps.length > 0) {
    return {
      hypotheses: topHypotheses,
      needsMoreData: true,
      dataGaps: state.dataGaps,
    }
  }

  // LOW confidence + no gaps: Promote with low confidence (best effort)
  return {
    hypotheses: topHypotheses,
    needsMoreData: false,
  }
}
```

**Routing decision**:
- HIGH (>0.7): Promote to `hypotheses` -> END (supervisor routes to resolver)
- LOW + verifiable gaps: Write `dataGaps` -> END (supervisor routes to gatherer)
- LOW + no gaps: Promote with low confidence -> END (supervisor decides)

## Step 7: Implement Analyst Verification Tools

### search-similar-incidents

**Modify**: `agents/src/tools/analyst/search-similar-incidents.ts`

```typescript
export const searchSimilarIncidents = tool(
  async (input, config: RunnableConfig) => {
    const dataProvider = config.configurable?.dataProvider
    if (!dataProvider?.fetchSimilarIncidents) {
      return JSON.stringify({ incidents: [], message: "No similar incident search available" })
    }

    const result = await dataProvider.fetchSimilarIncidents({
      incidentId: input.incidentId,
      serviceId: input.serviceId,
      title: input.title,
      limit: input.limit ?? 5,
    })

    return JSON.stringify(result)
  },
  {
    name: "search_similar_incidents",
    description: "Search for similar past incidents by service, title, and severity",
    schema: SearchSimilarIncidentsSchema,
  }
)
```

Queries `IncidentSimilarity` table + Incident data via DataProvider.

### query-gathered-data

**Modify**: `agents/src/tools/analyst/query-gathered-data.ts`

```typescript
export const queryGatheredData = tool(
  async (input, config: RunnableConfig) => {
    const state = config.configurable?.state
    const gatheredData = state?.gatheredData
    if (!gatheredData) return JSON.stringify({ results: [] })

    // Structured search over gatheredData by source type, time range, keywords
    const results = filterGatheredData(gatheredData, {
      source: input.source,
      timeRange: input.timeRange,
      keywords: input.keywords,
    })

    return JSON.stringify(results)
  },
  {
    name: "query_gathered_data",
    description: "Search the gathered investigation data by source, time range, or keywords",
    schema: QueryGatheredDataSchema,
  }
)
```

### retrieve-postmortems

**Modify**: `agents/src/tools/analyst/retrieve-postmortems.ts`

```typescript
// "Postmortems" = completed Investigation records with rootCause filled
export const retrievePostmortems = tool(
  async (input, config: RunnableConfig) => {
    const dataProvider = config.configurable?.dataProvider
    if (!dataProvider?.fetchPreviousInvestigation) {
      return JSON.stringify({ postmortems: [] })
    }

    // Query Investigation table for completed investigations with matching criteria
    const result = await dataProvider.fetchPreviousInvestigation(input.incidentId)
    return JSON.stringify(result ? [result] : [])
  },
  {
    name: "retrieve_postmortems",
    description: "Retrieve past investigation postmortems for similar incidents",
    schema: RetrievePostmortemsSchema,
  }
)
```

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/src/agents/analyst/nodes/form-hypotheses.ts` | LLM hypothesis generation |
| Modify | `agents/src/agents/analyst/nodes/evaluate-evidence.ts` | LLM evidence evaluation |
| Modify | `agents/src/agents/analyst/nodes/aggregate-results.ts` | Deterministic ranking |
| Modify | `agents/src/agents/analyst/nodes/challenge.ts` | LLM contradiction search |
| Modify | `agents/src/agents/analyst/nodes/confidence-check.ts` | Deterministic scoring + routing |
| Modify | `agents/src/agents/analyst/graph.ts` | Add Send() for parallel evaluation |
| Modify | `agents/src/agents/analyst/state.ts` | Add currentHypothesis channel |
| Modify | `agents/src/tools/analyst/search-similar-incidents.ts` | Real DB query |
| Modify | `agents/src/tools/analyst/query-gathered-data.ts` | Structured state search |
| Modify | `agents/src/tools/analyst/retrieve-postmortems.ts` | Real postmortem lookup |

## Tests

### Unit Tests

**Create**: `agents/src/__tests__/analyst/form-hypotheses.test.ts`
- Mock LLM -> verify 2-4 hypotheses generated with valid categories
- Verify IDs are unique
- Verify initial confidence scores within [0, 1]

**Create**: `agents/src/__tests__/analyst/evaluate-evidence.test.ts`
- Mock LLM -> verify evidence classification (supporting vs contradicting)
- Verify confidence updates

**Create**: `agents/src/__tests__/analyst/aggregate-results.test.ts`
- Pure function: empty input -> empty output
- Score calculation: verify ranking order
- Low confidence elimination: < 0.1 filtered out
- Edge case: all hypotheses below threshold

**Create**: `agents/src/__tests__/analyst/challenge.test.ts`
- Mock LLM -> verify contradictions found
- Verify confidence adjustments applied correctly
- Edge case: no contradictions found

**Create**: `agents/src/__tests__/analyst/confidence-check.test.ts`
- HIGH confidence (>0.7): promotes to hypotheses, needsMoreData=false
- LOW + gaps: needsMoreData=true, dataGaps populated
- LOW + no gaps: promotes with low confidence
- No viable hypotheses: needsMoreData=true

### Integration Test

**Create**: `agents/src/__tests__/analyst/subgraph.test.ts`
- Full subgraph execution with mock LLM and sample gatheredData
- Verify Send() parallelization per hypothesis
- Verify convergence at aggregate_results
- End-to-end: hypotheses in -> confidence-scored hypotheses out

## Verification

1. `pnpm typecheck` passes
2. `pnpm test` passes
3. Analyst subgraph runs in isolation with mock data
4. Generates 2-4 hypotheses with valid categories
5. Evidence evaluation produces structured supporting/contradicting evidence
6. `Send()` correctly parallelizes evaluation per hypothesis
7. Challenge finds contradictions and adjusts confidence
8. `needsMoreData` / `dataGaps` populated when evidence is insufficient
9. High-confidence hypotheses promoted to shared state correctly
