# Phase 4: Gatherer Agent

**Status**: COMPLETED (updated Phase 4.5: deep agent migration)
**Dependencies**: Phase 3 (skills + SKILL.md), Phase 2 (scout populates initial context)

## Goal

Implement the gatherer as a `createDeepAgent` wrapper with SKILL.md-based progressive tool disclosure. The gatherer autonomously decides which tools to call, collects data, and produces structured `GatheredData`.

## Key Design Decision: Progressive Tool Disclosure via Deep Agents (Phase 4.5)

**Original (Phase 4):** All 8 tools bound upfront with `createReactAgent` + informational `load_skill` tool.

**Updated (Phase 4.5):** Migrated to `createDeepAgent` from `deepagents` package with real tool gating:
- **SKILL.md files** define skills with YAML frontmatter (`name`, `description`, `allowed-tools`, `metadata`)
- **Built-in skills middleware** from deepagents injects skill summaries into system prompt and provides `read_file` via `FilesystemBackend`
- **Custom ToolGatingMiddleware** enforces tool access — tools are hidden until the agent reads the corresponding SKILL.md
- **`inferSkillsUsed`** replaced by `loadedSkillNames` closure (tracked by ToolGatingMiddleware)
- **`load_skill` tool** deleted (replaced by backend `read_file` on SKILL.md paths)

Shared infrastructure (`createDeepAgentConfig`, `ToolGatingMiddleware`, SKILL.md format) will be reused by analyst (Phase 6) and resolver (Phase 7).

## API Decision: `createDeepAgent` (from `deepagents`)

`createDeepAgent` wraps `createAgent` from `langchain` with built-in prompt caching, tool patching, summarization, and 10K recursion limit. Returns `DeepAgent extends ReactAgent` — compatible with our `StateGraph` wrapper node. Accepts `BaseChatModel` instance for `model` parameter. `responseFormat` requires wrapping Zod schema with `toolStrategy()` from `langchain`.

## Implementation

### Step 1: `extractGatheredData` — pure data extraction

**File**: `agents/src/agents/gatherer/index.ts`

Static `TOOL_DATA_MAP` lookup table maps each tool name to a `GatheredData` field + expected data key:

| Tool Name | GatheredData Field | Data Key |
|-----------|-------------------|----------|
| `search_logs` | `logs` | `logs` |
| `analyze_log_patterns` | `logs` | `patterns` |
| `search_code` | `codeSearchResults` | `results` |
| `get_file_content` | `codeSearchResults` | `content` |
| `get_recent_commits` | `commits` | `commits` |
| `get_deployment_history` | `deployments` | `deployments` |
| `search_similar_resolutions` | `similarIncidents` | `resolutions` |
| `lookup_runbook` | `similarIncidents` | `runbook` |

- Uses `isToolMessage()` from `@langchain/core/messages` for type-safe filtering
- `safeJsonParse` handles string and pre-parsed object content
- `load_skill` messages are deliberately not mapped (no data payload)
- Merging is additive (append to existing arrays)

### Step 2: `createGathererNode` — deep agent implementation

```
createGathererNode(integrations, mcpTools)
  └─ outer closure (build time):
       - createDeepAgentConfig("gatherer") → { skillsSources, backend, createMiddleware }
       - loadSkillMetadata(integrations) → PrismaLensSkillMetadata[]
       - buildSkillAllowedToolsMap(skills) → Map<skillName, toolNames[]>
       - buildToolsFromIntegrations(integrations) → StructuredToolInterface[]
  └─ returned async fn (per invocation):
       1. Create fresh loadedSkillNames[] + ToolGatingMiddleware
       2. Build systemPrompt from state.incident + state.gatheredData via gathererPrompt()
       3. createDeepAgent({ model, tools, systemPrompt, skills, backend, middleware, responseFormat })
       4. agent.invoke({ messages: [] }, { signal: config.signal })
       5. extractGatheredData(result.messages, state.gatheredData)
       6. Return { gatheredData, skillsLoaded: loadedSkillNames }
```

### Step 4: Wire gatherer into investigation graph

**File**: `agents/src/graph/investigation-graph.ts`

- Added `mcpTools?: StructuredToolInterface[]` to `InvestigationGraphDeps`
- Added gatherer node: `.addNode("gatherer", createGathererNode(...))`
- Added supervisor `ends: ["gatherer", "__end__"]` so LangGraph knows gatherer is a valid Command destination
- Added `gatherer → supervisor` edge
- Updated Studio entry point to pass `mcpTools: []`

Gatherer is wired and reachable via Command, but the supervisor stub still routes to `__end__`. Phase 5 enables `Command({ goto: "gatherer" })`.

## Files Changed

### Phase 4 (original)
| Action | File | Purpose |
|--------|------|---------|
| Modify | `agents/src/agents/gatherer/index.ts` | `extractGatheredData` + `createGathererNode` |
| Modify | `agents/src/graph/investigation-graph.ts` | Wire gatherer node, add `mcpTools` to deps, supervisor `ends` |
| Create | `agents/src/__tests__/gatherer/extract-gathered-data.test.ts` | Unit tests for data extraction |
| Create | `agents/src/__tests__/gatherer/gatherer-node.test.ts` | Factory + graph compilation tests |

### Phase 4.5 (deep agent migration)
| Action | File | Purpose |
|--------|------|---------|
| Rewrite | `agents/src/agents/gatherer/index.ts` | `createDeepAgent` wrapper, removed `inferSkillsUsed` |
| Rewrite | `agents/src/tools/skills/index.ts` | `loadSkillMetadata`, `buildSkillAllowedToolsMap`, `buildToolsFromIntegrations` |
| Rewrite | `agents/src/tools/types.ts` | `PrismaLensSkillMetadata` (extends deepagents `SkillMetadata`) |
| Modify | `agents/src/tools/skills/{log,code,change,precedent}.ts` | Removed `*Skill` object exports, kept tool exports |
| Create | `agents/src/config/deep-agent-defaults.ts` | Shared deep agent config factory |
| Create | `agents/src/middleware/tool-gating-middleware.ts` | Tool access enforcement middleware |
| Create | `skills/gatherer/{log,code,change,precedent}/SKILL.md` | Skill definitions (YAML frontmatter + instructions) |
| Create | `skills/{common,analyst,resolver}/` | Empty placeholder dirs for future deep agents |
| Delete | `agents/src/tools/skills/load-skill.ts` | Replaced by backend `read_file` |
| Delete | `agents/src/__tests__/tools/load-skill.test.ts` | Tests for deleted file |
| Modify | `agents/src/tools/index.ts` | Updated exports |
| Modify | `agents/src/index.ts` | Updated exports, added `createToolGatingMiddleware` |
| Modify | `agents/src/__tests__/gatherer/extract-gathered-data.test.ts` | Removed `inferSkillsUsed` tests |
| Create | `agents/src/__tests__/middleware/tool-gating-middleware.test.ts` | 16 tests for middleware |
| Add dep | `agents/package.json` | `deepagents@^1.8.0`, `langchain@^1.2.25` |

## Tests: 78 total (across package)

### extract-gathered-data.test.ts (17 tests)
- Empty messages → returns existingData unchanged (new object, not mutation)
- `search_logs` → extracts to `logs` field
- `analyze_log_patterns` → extracts to `logs` field
- `search_code` → extracts to `codeSearchResults` field
- `get_file_content` → extracts singular value to `codeSearchResults`
- `get_recent_commits` → extracts to `commits` field
- `get_deployment_history` → extracts to `deployments` field
- `search_similar_resolutions` → extracts to `similarIncidents` field
- Multiple tool messages → merges additively
- Merges with existing data (append, not replace)
- Malformed JSON → skips gracefully
- Non-tool messages (AIMessage, HumanMessage) → skipped
- Unknown tool messages → skipped (no data mapping)
- Missing expected data key → skipped
- Pre-parsed object content handled

### gatherer-node.test.ts (4 tests)
- `createGathererNode` returns a function
- Accepts integrations and mcpTools parameters
- Returns function with no mcpTools parameter
- Graph compiles successfully with gatherer node wired

### tool-gating-middleware.test.ts (16 tests)
- `extractSkillNameFromPath`: standard paths, virtual paths, nested paths, edge cases
- Gating logic: hides gated tools when no skills loaded
- Gating logic: reveals tools after skill loaded
- Gating logic: reveals all tools when all skills loaded
- Gating logic: keeps non-gated tools always visible
- Detection: detects skill load from `read_file` on SKILL.md
- Detection: ignores non-SKILL.md reads
- Detection: no duplicate skill names
- Detection: works with `read` tool name
- Detection: ignores non-read tool calls

## Not in Scope

- Per-node timeout wrapper (`withTimeout`) — executor's 5-min AbortController suffices
- LLM integration tests — deferred to Phase 5
- Supervisor routing to gatherer — Phase 5
- Streaming — Phase 5
- Analyst/Resolver deep agent migration — deferred to Phases 6/7 (reevaluation notes added)
