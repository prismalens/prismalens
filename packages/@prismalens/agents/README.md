# @prismalens/agents

Multi-agent system for automated incident investigation using LangGraph and DeepAgents.

## Architecture

Two-layer graph architecture for incident investigation:

```
┌─────────────────────────────────────────────────────────────┐
│                    investigationGraph                        │
│  (LangGraph StateGraph - Pipeline Orchestration)            │
│                                                              │
│   START → validateAlerts → commander → writeToApi → END     │
│                               │                              │
│                               ▼                              │
│           ┌───────────────────────────────────┐             │
│           │         Commander Agent            │             │
│           │      (DeepAgent - Investigation)   │             │
│           │                                    │             │
│           │  ┌────────────┐ ┌──────────────┐  │             │
│           │  │Cartographer│ │  Detective   │  │             │
│           │  │(read-only) │ │(root cause)  │  │             │
│           │  └────────────┘ └──────────────┘  │             │
│           │         ┌──────────────┐          │             │
│           │         │   Surgeon    │          │             │
│           │         │(fix proposal)│          │             │
│           │         └──────────────┘          │             │
│           └───────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Investigation Graph (Outer)

Pipeline orchestration with PostgreSQL checkpointing:

- **validateAlerts**: Validates input, calculates quality scores
- **commander**: Runs the DeepAgent investigation
- **writeToApi**: Persists results to database

### Commander Agent (Inner)

DeepAgent that orchestrates the investigation workflow:

1. Gathers initial context via Cartographer
2. Creates investigation plan using `write_todos`
3. Delegates to SubAgents for specific tasks
4. Compiles findings into final report

## SubAgents

Each SubAgent has specialized skills and optional MCP tools for deep code analysis.

### Cartographer (Context Gatherer)

**Role**: READ-ONLY exploration and context gathering. Cannot modify anything.

**Skills**:
- `log-analysis` - Fetch and analyze logs from deployment platforms
- `code-search` - Search codebase for error origins and patterns
- `deployment-check` - Check deployment status and history
- `recent-commits` - Analyze recent git commits for changes
- `dependency-trace` (MCP) - Trace file dependencies to find related code
- `code-structure` (MCP) - Analyze code structure using AST-based tools

**Output**: Returns structured summaries with findings, confidence levels, and suggested next steps.

### Detective (Root Cause Analyst)

**Role**: Analyze evidence and form hypotheses about root cause.

**Skills**:
- `hypothesis-formation` - Form and validate root cause hypotheses
- `timeline-analysis` - Build chronological event timelines
- `pattern-correlation` - Cross-reference patterns across data sources
- `error-origin-trace` (MCP) - Trace errors back to their actual source
- `cross-service-analysis` (MCP) - Analyze errors across services to find cascade origins

**Confidence Levels**:
- 90-100%: Direct evidence (stack trace, config diff)
- 70-89%: Strong circumstantial evidence
- 50-69%: Some supporting evidence but gaps remain
- Below 50%: Speculation, needs more investigation

**Key Rule**: Surgeon cannot proceed unless Detective has ≥70% confidence.

### Surgeon (Fix Proposer)

**Role**: Propose specific, actionable fixes for human review. Does NOT implement changes.

**Skills**:
- `code-fix` - Propose specific code changes with search/replace blocks
- `rollback-proposal` - Recommend deployment rollbacks
- `config-change` - Recommend configuration changes

**Output**: Fix proposals including code changes, verification steps, and priority.

## Skills System

Skills provide specialized workflows via SKILL.md files. Each skill contains step-by-step instructions that are loaded on-demand when the agent needs them.

### Directory Structure

```
src/skills/
├── cartographer/
│   ├── log-analysis/SKILL.md
│   ├── code-search/SKILL.md
│   ├── deployment-check/SKILL.md
│   ├── recent-commits/SKILL.md
│   ├── dependency-trace/SKILL.md      # MCP-powered
│   └── code-structure/SKILL.md        # MCP-powered
├── detective/
│   ├── hypothesis-formation/SKILL.md
│   ├── timeline-analysis/SKILL.md
│   ├── pattern-correlation/SKILL.md
│   ├── error-origin-trace/SKILL.md    # MCP-powered
│   └── cross-service-analysis/SKILL.md # MCP-powered
└── surgeon/
    ├── code-fix/SKILL.md
    ├── rollback-proposal/SKILL.md
    └── config-change/SKILL.md
```

### Custom Skills

Add custom skills via environment variables:

```bash
# Agent-specific custom skills
CARTOGRAPHER_SKILLS_DIR=/path/to/custom/cartographer
DETECTIVE_SKILLS_DIR=/path/to/custom/detective
SURGEON_SKILLS_DIR=/path/to/custom/surgeon

# Shared custom skills (looks for subagent-named subdirs)
ADDITIONAL_SKILLS_DIR=/path/to/additional/skills
```

### Creating a Skill

Create a `SKILL.md` file with frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---

# My Skill

## Purpose
Why this skill exists...

## Process
1. Step one
2. Step two

## Output Format
What the agent should return...
```

## MCP Integration

Optional MCP (Model Context Protocol) servers for deep code analysis. These run as separate processes and communicate via stdio.

### Available MCP Servers

**Code Pathfinder** (`@anthropic/code-pathfinder-mcp`)
- `mcp_get_callers` - Find all functions that call a given function
- `mcp_get_callees` - Find all functions called by a given function
- `mcp_find_symbol` - Locate a function, class, or symbol
- `mcp_resolve_import` - Resolve import paths to file locations

**Code Index** (`code-index-mcp`)
- `mcp_search_code_advanced` - Smart code search with regex and fuzzy matching
- `mcp_get_file_summary` - Analyze file structure (functions, imports, complexity)
- `mcp_build_deep_index` - Build full symbol index for deep analysis

**Ripgrep** (`mcp-ripgrep`)
- `mcp_search_pattern` - Fast text/regex search
- `mcp_count_matches` - Count pattern occurrences

### Enabling MCP Servers

```bash
# Code Pathfinder
MCP_CODE_PATHFINDER_ENABLED=true
MCP_CODE_PATHFINDER_PROJECT_PATH=/path/to/project

# Code Index
MCP_CODE_INDEX_ENABLED=true
MCP_CODE_INDEX_PROJECT_PATH=/path/to/project

# Ripgrep
MCP_RIPGREP_ENABLED=true
MCP_RIPGREP_BASE_DIR=/path/to/search
```

## Tools

### Tool Bundles

Tools are organized into bundles with TOOLS.md manifests:

```
src/tools/manifests/
├── github/
│   ├── TOOLS.md        # Tool descriptions
│   └── openapi.json    # API spec
├── render/
│   ├── TOOLS.md
│   └── openapi.json
└── repo/
    └── TOOLS.md
```

**Available Bundles**:
- `github-code` - GitHub repository search and file access
- `render-logs` - Render.com deployment logs and status
- `repo-files` - Local repository file operations

### Progressive Tool Disclosure

Optional token-efficient tool loading. Instead of loading all tools at once, agents discover tools on-demand:

```typescript
const agent = createCommander({
  integrations: [...],
  useProgressiveDisclosure: true,
  preEnabledBundles: ['repo-files'], // Pre-load essentials
});
```

With progressive disclosure, agents use meta-tools:
- `search_tools` - Find tools by describing what you need
- `call_tool` - Execute a tool from an enabled bundle
- `list_enabled_tools` - See currently available tools

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| **LLM Configuration** | | |
| `LLM_PROVIDER` | LLM provider: `anthropic`, `openai`, `google` | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `GOOGLE_API_KEY` | Google AI API key | - |
| **Model Overrides** | | |
| `COMMANDER_MODEL` | Model for Commander agent | Provider default |
| `CARTOGRAPHER_MODEL` | Model for Cartographer | Provider default |
| `DETECTIVE_MODEL` | Model for Detective | Provider default |
| `SURGEON_MODEL` | Model for Surgeon | Provider default |
| **MCP Configuration** | | |
| `MCP_CODE_PATHFINDER_ENABLED` | Enable Code Pathfinder | `false` |
| `MCP_CODE_PATHFINDER_PROJECT_PATH` | Project path for analysis | - |
| `MCP_CODE_INDEX_ENABLED` | Enable Code Index | `false` |
| `MCP_CODE_INDEX_PROJECT_PATH` | Project path for indexing | - |
| `MCP_RIPGREP_ENABLED` | Enable Ripgrep | `false` |
| `MCP_RIPGREP_BASE_DIR` | Base directory for search | - |
| **Skills Configuration** | | |
| `CARTOGRAPHER_SKILLS_DIR` | Custom Cartographer skills | - |
| `DETECTIVE_SKILLS_DIR` | Custom Detective skills | - |
| `SURGEON_SKILLS_DIR` | Custom Surgeon skills | - |
| `ADDITIONAL_SKILLS_DIR` | Shared custom skills | - |
| **LangSmith** | | |
| `LANGSMITH_TRACING` | Enable LangSmith tracing | `false` |
| `LANGSMITH_API_KEY` | LangSmith API key | - |

### SubAgent Configuration

```typescript
import { createCommander } from "@prismalens/agents/agents";
import { createMCPClientManager } from "@prismalens/agents/mcp";

// Optional: Create MCP client manager
const mcpManager = createMCPClientManager({
  MCP_CODE_PATHFINDER_ENABLED: true,
  MCP_CODE_PATHFINDER_PROJECT_PATH: '/path/to/project',
});
await mcpManager.connectAll();

const agent = createCommander({
  integrations: [
    { type: 'github', connectionId: '...', credentials: {...} },
    { type: 'render', connectionId: '...', credentials: {...} },
  ],
  models: {
    commander: 'claude-sonnet-4-20250514',
    cartographer: 'claude-sonnet-4-20250514',
    detective: 'claude-sonnet-4-20250514',
    surgeon: 'claude-sonnet-4-20250514',
  },
  incidentContext: {
    incidentId: 'inc-123',
    title: 'High CPU usage in API server',
    severity: 'high',
    priority: 'p2',
    serviceName: 'api-server',
    alertCount: 3,
  },
  enableSkills: true, // Enable SKILL.md loading (default: true)
  useProgressiveDisclosure: false, // On-demand tool loading
  mcpClientManager: mcpManager, // Optional MCP tools
});
```

## Directory Structure

```
packages/@prismalens/agents/
├── src/
│   ├── agents/
│   │   ├── commander/
│   │   │   ├── agent.ts       # DeepAgent + LangGraph integration
│   │   │   ├── prompts.ts     # System prompts
│   │   │   └── index.ts
│   │   ├── subagents/
│   │   │   └── index.ts       # Cartographer, Detective, Surgeon
│   │   └── index.ts
│   ├── graph/
│   │   ├── graph.ts           # Investigation pipeline
│   │   ├── persistence/
│   │   │   └── checkpointer.ts # PostgreSQL checkpointing
│   │   └── index.ts
│   ├── tools/
│   │   ├── bundles/           # Tool bundle system
│   │   │   ├── types.ts
│   │   │   ├── registry.ts
│   │   │   ├── manifest.ts
│   │   │   └── sources/
│   │   ├── manifests/         # Tool descriptions
│   │   │   ├── github/
│   │   │   ├── render/
│   │   │   └── repo/
│   │   ├── mcp/               # MCP tool wrappers
│   │   │   └── index.ts
│   │   ├── github.ts          # GitHub tools
│   │   ├── render.ts          # Render.com tools
│   │   ├── repo.ts            # Local repo tools
│   │   ├── hypothesis.ts      # Detective tools
│   │   ├── fix-proposal.ts    # Surgeon tools
│   │   ├── factory.ts         # Tool creation
│   │   └── index.ts
│   ├── skills/                # SKILL.md files
│   │   ├── cartographer/
│   │   ├── detective/
│   │   └── surgeon/
│   ├── middleware/
│   │   ├── tool-disclosure.ts # Progressive disclosure
│   │   ├── system-reminders.ts # Agent reminders
│   │   └── index.ts
│   ├── mcp/
│   │   ├── client.ts          # MCP client manager
│   │   └── index.ts
│   ├── llm/
│   │   ├── factory.ts         # Multi-provider LLM creation
│   │   └── index.ts
│   ├── executor/              # Execution utilities
│   │   └── index.ts
│   ├── types/
│   │   ├── state.ts           # State definitions
│   │   └── index.ts
│   └── index.ts
├── __tests__/                 # Test suite (see __tests__/README.md)
├── langgraph.json             # LangGraph Studio config
├── vitest.config.ts           # Unit/integration test config
├── vitest.e2e.config.ts       # E2E test config
└── package.json
```

## Usage

### Running an Investigation

```typescript
import { runInvestigation } from "@prismalens/agents/graph";

const result = await runInvestigation({
  investigationId: "inv-123",
  incidentId: "inc-456",
  alerts: [
    { alertId: "alert-1", title: "High CPU", severity: "high" }
  ],
  integrations: [
    { type: "github", connectionId: "...", credentials: {...} },
    { type: "render", connectionId: "...", credentials: {...} },
  ],
});

console.log(result.hypotheses);      // Root cause hypotheses
console.log(result.recommendations); // Fix proposals
console.log(result.summary);         // Investigation summary
```

### Resuming an Investigation

```typescript
import { resumeInvestigation } from "@prismalens/agents/graph";

// Resume from checkpoint
const result = await resumeInvestigation("inv-123");
```

## LangGraph Studio

The `langgraph.json` exports two graphs for LangGraph Studio:

```json
{
  "graphs": {
    "investigation": "./dist/graph/graph.js:investigationGraph",
    "commander": "./dist/agents/commander/agent.js:graph"
  }
}
```

- **investigation**: Full pipeline with checkpointing
- **commander**: Inner agent for debugging/testing

## Exports

```typescript
// Main graph
import { runInvestigation, resumeInvestigation } from "@prismalens/agents/graph";

// Commander agent
import { createCommander } from "@prismalens/agents/agents";

// Tools
import { createToolsForAgent } from "@prismalens/agents/tools";

// MCP
import { createMCPClientManager, createMCPClients } from "@prismalens/agents/mcp";

// Types
import type { InvestigationState, IntegrationContext } from "@prismalens/agents/types";

// LLM factory
import { createLLM } from "@prismalens/agents/llm";
```

## Development

```bash
pnpm build        # Build package
pnpm typecheck    # Type check
pnpm test         # Run unit + integration tests
pnpm test:e2e     # Run E2E tests
pnpm test:coverage # Run with coverage
```

## Testing

See [__tests__/README.md](./__tests__/README.md) for comprehensive test documentation.
