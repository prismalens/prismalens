# @prismalens/agents

Multi-agent system for automated incident investigation using LangGraph.

## Quick Start

```typescript
import { runInvestigation } from "@prismalens/agents/graph";

const result = await runInvestigation({
  investigationId: "inv-123",
  incidentId: "inc-456",
  incident: {
    incidentId: "inc-456",
    title: "High CPU usage in API server",
    severity: "high",
    priority: "p2",
    serviceName: "api-server",
    alertCount: 3,
  },
  alerts: [{ alertId: "alert-1", title: "CPU > 90%", severity: "high" }],
  integrations: [...],
  llmConfig: { provider: "anthropic", model: "claude-sonnet-4", apiKey: "..." },
});

console.log(result.hypotheses);      // Root cause hypotheses
console.log(result.recommendations); // Fix proposals
```

## Architecture

LangGraph Supervisor Pattern with parallel gatherers and sequential analysis:

```
START → validateIncident → preGather → cloneIfNeeded → supervisor ⟲ → writeToApi → END
                                                            ↑
                                        ┌───────────────────┴────────────────────┐
                                        │           Supervisor Loop               │
                                        ├─────────────────────────────────────────┤
                                        │  Phase 1: Parallel Gather               │
                                        │  ├─ log-gatherer    ─┐                  │
                                        │  ├─ code-searcher   ─┼→ supervisor      │
                                        │  └─ change-tracker  ─┘                  │
                                        │                                          │
                                        │  Phase 2: Analyze → detective            │
                                        │  Phase 3: Fix → surgeon                  │
                                        └─────────────────────────────────────────┘
```

For detailed architecture including the auto-generated graph, tools, and skills, see **[docs/GENERATED.md](docs/GENERATED.md)**.

## Development

```bash
pnpm build           # Build package
pnpm typecheck       # Type check
pnpm docs:generate   # Regenerate docs from code
```

## Testing

```bash
pnpm eval            # Run all evaluations
pnpm eval:smoke      # Quick smoke tests
pnpm eval:e2e        # Full E2E graph tests
pnpm eval:agents     # Agent tests only
pnpm eval:tools      # Tool tests only
```

For test structure and naming conventions, see **[evals/README.md](evals/README.md)**.

## Configuration

### LLM Provider

```bash
PRISMALENS_LLM_PROVIDER=anthropic  # anthropic, openai, groq, nvidia, ollama
ANTHROPIC_API_KEY=sk-...           # Provider API key
```

### Free Tier Options

| Provider | Limits | Best For |
|----------|--------|----------|
| **Groq** | 30 req/min, 100K tokens/day | Fast inference, testing |
| **NVIDIA NIM** | 40 req/min, unlimited | Smart reasoning |
| **Ollama** | Unlimited (local) | Privacy, offline |

### LangSmith Tracing

```bash
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_TRACING=true
LANGCHAIN_PROJECT=prismalens-agents-dev
```

## Exports

```typescript
import { runInvestigation, resumeInvestigation } from "@prismalens/agents/graph";
import { createLLM } from "@prismalens/agents/llm";
import type { InvestigationState } from "@prismalens/agents/types";
```

## Documentation

| Document | Description |
|----------|-------------|
| **[docs/GENERATED.md](docs/GENERATED.md)** | Auto-generated: Graph, Tools, Skills, State |
| **[evals/README.md](evals/README.md)** | Testing strategy and eval commands |

> **Note**: `docs/GENERATED.md` is auto-generated from code. Regenerate with `pnpm docs:generate`.

## LangGraph Studio

For interactive debugging with time-travel and state editing:

```bash
pnpm build
pnpm studio
# Open: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
```
