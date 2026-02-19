# Phase 4: Gatherer Agent

**Status**: PLANNED
**Dependencies**: Phase 3 (tools return real data), Phase 2 (scout populates initial context)
**Estimated effort**: 2-3 days

## Goal

Implement the gatherer as a `createReactAgent` wrapper with skill-based tools + LLM. The gatherer autonomously decides which tools to call, collects data, and produces a structured `GatheredData` summary.

## Grounding Notes (DB Schema & API Truth)

| Claim | Actual Truth Source | Status |
|-------|---------------------|--------|
| LLM factory supports multiple providers | `createLLM()` supports 6 providers: anthropic, openai, groq, ollama, google, openrouter. API keys from env vars | Confirmed (`agents/src/llm/factory.ts`) |
| Worker default LLM | `provider='anthropic'`, `model='claude-sonnet-4-20250514'` (from `worker/src/processor.ts`) | Confirmed |
| vitest available for testing | Must be added in Phase 2 | Phase 2 dependency |
| createReactAgent writes only to messages | LangGraph constraint: custom state channels readable via prompt, but only `messages` written | Confirmed (LangGraph docs) |
| GathererStateAnnotation extends MessagesAnnotation | Already implemented with `incident`, `alerts`, `gatheredData` channels | Confirmed (`agents/src/agents/gatherer/state.ts`) |
| gathererPrompt is parameterized | Both dynamic `gathererPrompt({...})` and static `GATHERER_PROMPT` exist | Confirmed (`agents/src/agents/gatherer/prompt.ts`) |

## Step 1: Implement extractGatheredData()

**Modify**: `agents/src/agents/gatherer/index.ts`

Parse agent messages to extract structured data from tool call results:

```typescript
function extractGatheredData(
  messages: BaseMessage[],
  existingData: GatheredData
): GatheredData {
  const result: GatheredData = { ...existingData }

  for (const msg of messages) {
    if (msg._getType() !== "tool") continue

    const toolMsg = msg as ToolMessage
    const parsed = safeJsonParse(toolMsg.content)
    if (!parsed) continue

    switch (toolMsg.name) {
      case "search_logs":
        result.logs = [...(result.logs ?? []), ...(parsed.entries ?? [])]
        break
      case "get_recent_commits":
      case "search_code":
        result.commits = [...(result.commits ?? []), ...(parsed.results ?? [])]
        result.codeSearchResults = [...(result.codeSearchResults ?? []), ...(parsed.results ?? [])]
        break
      case "get_recent_changes":
        result.deployments = [...(result.deployments ?? []), ...(parsed.changes ?? [])]
        break
      case "search_precedents":
        result.similarIncidents = [...(result.similarIncidents ?? []), ...(parsed.incidents ?? [])]
        break
    }
  }

  return result
}
```

Key considerations:
- Scan all `ToolMessage` instances in the message array
- Parse each by tool name to categorize into the correct GatheredData field
- Merge with existing gatheredData (additive, not replacing)
- Handle malformed tool responses gracefully (skip, don't crash)

## Step 2: Implement createGathererNode()

**Modify**: `agents/src/agents/gatherer/index.ts`

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { createLLM } from "../../llm/factory.js"
import { gathererPrompt } from "./prompt.js"
import { GathererStateAnnotation } from "./state.js"
import { GathererSummarySchema } from "../../tools/schemas.js"

export function createGathererNode(
  integrations: IntegrationContext[],
  mcpTools: StructuredToolInterface[] = [],
) {
  return async (state: InvestigationState, config: RunnableConfig) => {
    // 1. Load skills based on active integrations
    const skills = loadSkills(integrations)
    const tools = [...skills.flatMap(s => s.tools), ...mcpTools]

    // 2. Create the LLM from config (not hardcoded)
    const llm = createLLM(state.config.llm)

    // 3. Build dynamic prompt with incident context
    const prompt = gathererPrompt({
      incidentTitle: state.incident?.title ?? "Unknown",
      severity: state.incident?.severity ?? "medium",
      existingData: state.gatheredData?.coverage?.sourcesWithData ?? [],
      dataGaps: state.dataGaps,
    })

    // 4. Create and invoke the ReAct agent
    const agent = createReactAgent({
      llm,
      tools,
      stateSchema: GathererStateAnnotation,
      prompt,
      responseFormat: GathererSummarySchema,
    })

    const result = await agent.invoke(
      {
        messages: [],
        incident: state.incident,
        alerts: state.alerts,
        gatheredData: state.gatheredData,
      },
      config,  // Pass config through for credentials + tokenTracker
    )

    // 5. Extract structured data from messages
    const gatheredData = extractGatheredData(result.messages, state.gatheredData)

    // 6. Merge structured response into coverage
    if (result.structuredResponse) {
      gatheredData.coverage = {
        ...(gatheredData.coverage ?? {}),
        sourcesQueried: result.structuredResponse.sourcesQueried,
        sourcesWithData: result.structuredResponse.sourcesWithData,
        dataGaps: result.structuredResponse.dataGaps,
      }
    }

    return { gatheredData }
  }
}
```

### Design Notes

- `createReactAgent` handles the tool-calling loop internally (the LLM decides which tools to call and when to stop)
- Custom state channels (`incident`, `alerts`, `gatheredData`) are readable by the prompt function but only `messages` is written by the agent
- The wrapper function extracts structured data from messages after the agent completes
- `responseFormat: GathererSummarySchema` forces a structured final summary from the LLM
- Config is passed through so tools can access `configurable.credentials` and `configurable.tokenTracker`

## Step 3: Per-node Timeout Wrapper

**Create**: `agents/src/utils/node-timeout.ts`

```typescript
type NodeFunction<S> = (state: S, config: RunnableConfig) => Promise<Partial<S>>

export function withTimeout<S>(
  fn: NodeFunction<S>,
  timeoutMs: number,
): NodeFunction<S> {
  return async (state: S, config: RunnableConfig) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fn(state, {
        ...config,
        signal: controller.signal,
      })
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Return partial state on timeout rather than crashing
        return {} as Partial<S>
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
```

Apply to gatherer:

```typescript
// In graph builder
.addNode("gatherer", withTimeout(createGathererNode(integrations, mcpTools), 60_000))
```

Default: 60s per node. Configurable via `InvestigationConfig.nodeTimeout`.

## Step 4: Wire Gatherer into Graph

**Modify**: `agents/src/graph/investigation-graph.ts`

```typescript
const graph = new StateGraph(InvestigationStateAnnotation)
  .addNode("scout", createScoutNode(deps.dataProvider))
  .addNode("supervisor", supervisorNode)
  .addNode("gatherer", withTimeout(
    createGathererNode(deps.integrations, deps.mcpTools ?? []),
    60_000,
  ))
  .addEdge("__start__", "scout")
  .addEdge("scout", "supervisor")
  .addEdge("gatherer", "supervisor")
  // supervisor stub still routes to __end__ (Phase 5 adds full routing)
```

Note: In Phase 4, the supervisor stub still routes to `__end__`. The gatherer is wired into the graph but not reachable until Phase 5 enables LLM routing.

## Step 5: Update InvestigationGraphDeps

**Modify**: `agents/src/graph/investigation-graph.ts`

```typescript
export interface InvestigationGraphDeps {
  dataProvider: DataProvider
  integrations: IntegrationContext[]
  checkpointer?: BaseCheckpointSaver
  mcpTools?: StructuredToolInterface[]  // NEW
}
```

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/src/agents/gatherer/index.ts` | Implement createGathererNode + extractGatheredData |
| Create | `agents/src/utils/node-timeout.ts` | Per-node timeout wrapper |
| Modify | `agents/src/graph/investigation-graph.ts` | Wire gatherer node + update deps interface |

## Tests

### Unit Tests

**Create**: `agents/src/__tests__/gatherer/extract-gathered-data.test.ts`

- Empty messages -> returns existingData unchanged
- Single tool message (search_logs) -> extracts log entries
- Multiple tool messages -> merges all results
- Malformed tool response -> skips without crashing
- Merging with existing data -> additive, not replacing

### Integration Tests

**Create**: `agents/src/__tests__/gatherer/gatherer-node.test.ts`

- Mock LLM (responds with tool calls then final answer)
- StubDataProvider for integration context
- Verify: gatherer produces structured gatheredData
- Verify: GathererSummarySchema response format works

### Timeout Tests

**Create**: `agents/src/__tests__/utils/node-timeout.test.ts`

- Fast function completes normally
- Slow function aborts after deadline
- AbortError returns empty partial state (not a crash)

## Verification

1. `pnpm typecheck` passes
2. `pnpm test` passes
3. Invoke gatherer node in isolation with mock LLM -> returns structured `gatheredData`
4. `extractGatheredData` correctly parses tool messages into typed data
5. Timeout wrapper correctly aborts long-running nodes
6. Graph: `scout -> supervisor(stub -> __end__)` still works; gatherer is wired but not routed to yet
7. `GathererSummarySchema` integration: structured response feeds into coverage
