# @prismalens/agents

Minimal investigation executor with single dummy node for PrismaLens incident investigation.

## Overview

This package provides a clean, minimal implementation of the investigation executor that maintains API compatibility with the previous complex implementation while providing a foundation for incremental feature development.

## Architecture

### Current Implementation

**Single-Node Graph:**
```
START → investigator (dummy) → END
```

The `investigator` node currently returns a placeholder result with:
- Status: `completed`
- Summary: "Investigation completed (dummy implementation)"
- No root cause, hypotheses, or recommendations

### Key Components

1. **InvestigationExecutor** (`src/executor/investigation-executor.ts`)
   - Main entry point for running investigations
   - Creates simple LangGraph workflow
   - Handles callbacks (onStart, onComplete, onError)
   - Returns `InvestigationResult`

2. **Type System** (`src/types/`)
   - `contexts.ts` - IncidentContext, AlertContext, IntegrationContext
   - `inputs.ts` - InvestigationInput, InvestigationConfig, LLMProviderConfig
   - `results.ts` - InvestigationResult, Hypothesis, Recommendation
   - `state.ts` - InvestigationState (LangGraph state)

3. **LLM Factory** (`src/llm/factory.ts`)
   - Creates chat models from provider configs
   - Supports: Anthropic, OpenAI, Groq, Ollama, Google, OpenRouter
   - Not currently used (reserved for future nodes)

4. **Utilities** (`src/utils/`)
   - `severity.ts` - mapSeverity function
   - `checkpoints.ts` - Stubbed checkpoint functions (return null/empty)

## Usage

### Basic Example

```typescript
import { InvestigationExecutor } from "@prismalens/agents"

// No configuration needed for minimal implementation
const executor = new InvestigationExecutor()

const result = await executor.execute({
  investigationId: "inv-001",
  incidentId: "inc-001",
  incident: { /* IncidentContext */ },
  alerts: [ /* AlertContext[] */ ],
  integrations: [ /* IntegrationContext[] */ ],
  config: {
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.2,
    },
  },
})

// Handle result
if (result.status === "completed") {
  console.log("Investigation completed:", result.summary)
} else {
  console.error("Investigation failed:", result.error)
}

await executor.close()
```

### API Compatibility

This package maintains full API compatibility with the previous implementation:

- ✅ All types match exactly (InvestigationInput, InvestigationResult, etc.)
- ✅ InvestigationExecutor interface is identical
- ✅ All exports from `@prismalens/agents` work as before
- ✅ queue.service.ts requires no changes
- ✅ settings.service.ts requires no changes
- ✅ progress.service.ts requires no changes (checkpoint functions stubbed)

## Development

### Build

```bash
pnpm build
```

### Type-check

```bash
pnpm typecheck
```

### Watch Mode

```bash
pnpm dev
```

## Roadmap

The following features can be added incrementally:

1. **Pre-check Node** - Validate incident data, check for duplicates
2. **Gatherer Node** - Fetch related metrics, logs, traces
3. **Analyzer Node** - Generate hypotheses using LLM
4. **Recommender Node** - Provide fix recommendations
5. **Supervisor Pattern** - Coordinate multi-agent workflow
6. **Checkpoint Support** - Enable pausing/resuming investigations
7. **Tool Integration** - Add MCP tools for external data sources
8. **Model Selection** - Dynamic model selection based on complexity

## Backup

The previous implementation has been preserved at:
```
packages/@prismalens/agents_old/
```

This can be referenced for:
- Type definitions
- Tool implementations
- Prompt templates
- Node logic
- Supervisor patterns

## Migration from Old Implementation

No changes required in consuming packages:

- API package works without modifications
- Worker package works without modifications (if using agents)
- All imports resolve correctly
- All types are compatible

## Notes

- **No Configuration Required**: Constructor takes no parameters (reserved for future options)
- **No LLM Calls**: The dummy node doesn't make any LLM calls yet
- **No Checkpoint Support**: Checkpoint functions are stubbed (return null/empty)
- **No Model Registry**: getModelsForProvider/getModelsRegistry are stubbed
- **No Tools**: MCP tools integration not yet implemented
- **No Supervisor**: No multi-agent coordination yet

