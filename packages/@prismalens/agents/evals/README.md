# PrismaLens Agent Evaluation System

This guide explains how the agent evaluation system works, how to run evaluations, and how to add new test scenarios.

## Quick Start

```bash
# Prerequisites
export LANGSMITH_API_KEY=lsv2_pt_...  # Get from https://smith.langchain.com
ollama run qwen3:14b                   # Or use cloud providers

# Run evaluations
cd packages/@prismalens/agents
pnpm eval                              # Full suite
pnpm eval:smoke                        # Quick validation
pnpm eval:e2e                          # Full graph tests
pnpm eval:agents                       # Agent component tests
pnpm eval:tools                        # Tool tests
```

## What is Agent Evaluation?

Agent evaluation tests whether the investigation agents correctly:
1. **Gather context** - Gatherer finds relevant code, logs, and changes
2. **Form hypotheses** - Detective identifies root causes with confidence scores
3. **Propose fixes** - Surgeon recommends actionable solutions

We use [LangSmith](https://smith.langchain.com) to track experiments, score outputs, and review results.

---

## Architecture Overview

### Three-Level Testing Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    Graph Level                          │
│         Full E2E investigation workflow                 │
│    Incident → PreGather → Commander → Results           │
├─────────────────────────────────────────────────────────┤
│                  Component Level                        │
│         Individual subagent testing                     │
│    Detective, Surgeon, Gatherer in isolation        │
├─────────────────────────────────────────────────────────┤
│                    Tool Level                           │
│           Individual tool functions                     │
│    form_hypothesis, propose_fix, etc.                   │
└─────────────────────────────────────────────────────────┘
```

### Directory Structure

```
evals/
├── setup/                          # Environment setup
│   ├── vitest.setup.ts            # LangSmith + env loading
│   └── seed-integrations.ts       # Test DB seeding
│
├── fixtures/                       # Test data factories
│   ├── incidents.ts               # Incident/alert factories
│   ├── integrations.ts            # Integration context
│   ├── llm-config.ts              # LLM configuration
│   └── index.ts
│
├── scenarios/                      # Test cases with mocks
│   ├── types.ts                   # Scenario type definitions
│   ├── code-bugs.scenarios.ts     # NullPointer, memory leaks
│   ├── config-issues.scenarios.ts # DB pools, timeouts
│   ├── infrastructure.scenarios.ts# OOM, CPU, memory
│   └── index.ts
│
├── evaluators/                     # Custom scoring functions
│   ├── hypothesis.evaluator.ts    # Hypothesis quality (0-100)
│   ├── recommendation.evaluator.ts# Fix actionability (0-100)
│   ├── trajectory.evaluator.ts    # Agent decision quality
│   ├── ground-truth.evaluator.ts  # Keyword/semantic matching
│   ├── llm-judge.evaluator.ts     # LLM-as-Judge evaluation
│   ├── unified.evaluator.ts       # Combined evaluation
│   └── index.ts
│
├── mocks/                          # Integration mocks
│   ├── pre-gathered.ts            # PreGatheredContext mocks
│   ├── change-scenarios.ts        # Change tracking mocks
│   ├── context-factory.ts         # Test context factories
│   └── index.ts
│
├── components/                     # [Agent] component tests
│   ├── detective.eval.ts          # [Agent] Detective › ...
│   └── surgeon.eval.ts            # [Agent] Surgeon › ...
│
├── tools/                          # [Tool] tests
│   ├── hypothesis.eval.ts         # [Tool] Hypothesis › ...
│   └── fix-proposal.eval.ts       # [Tool] Fix Proposal › ...
│
└── graph/                          # [E2E] full graph tests
    └── full-investigation.eval.ts # [E2E] Graph › ...
```

### Test Naming Convention

Tests use hierarchical prefixes for organization in VSCode Vitest extension:

```
[E2E] Graph › Smoke Test
[E2E] Graph › Easy Scenarios
[E2E] Graph › Medium Scenarios
[E2E] Graph › Hard Scenarios
[E2E] Graph › Clone Scenarios
[E2E] Graph › Trajectory Validation
[E2E] Graph › Performance
[Agent] Detective › Hypothesis Formation
[Agent] Detective › Tool Usage Trajectory
[Agent] Detective › Category Classification
[Agent] Surgeon › Recommendation Quality
[Agent] Surgeon › Tool Usage Trajectory
[Tool] Hypothesis › Schema
[Tool] Hypothesis › Evidence Quality
[Tool] Hypothesis › Confidence
[Tool] Fix Proposal › Schema
[Tool] Fix Proposal › Verification Steps
[Tool] Fix Proposal › Risk Assessment
```

---

## Running Evaluations

### Prerequisites

1. **LangSmith API Key** (required for tracing):
   ```bash
   export LANGSMITH_API_KEY=lsv2_pt_...
   export LANGSMITH_PROJECT=prismalens-agents-dev
   ```
   Get your key from: https://smith.langchain.com → Settings → API Keys

2. **LLM Provider** (choose one):

   **Option A: Local Ollama** (recommended for development)
   ```bash
   ollama run qwen3:14b              # ~5.5GB VRAM
   export PRISMALENS_LLM_PROVIDER=ollama
   export PRISMALENS_LLM_MODEL=qwen3:14b
   export PRISMALENS_OLLAMA_BASE_URL=http://localhost:11434
   ```

   **Option B: Groq** (free tier, fast)
   ```bash
   export GROQ_API_KEY=gsk_...
   export PRISMALENS_LLM_PROVIDER=groq
   export PRISMALENS_LLM_MODEL=llama-3.3-70b-versatile
   ```

   **Option C: Anthropic/OpenAI** (paid)
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export PRISMALENS_LLM_PROVIDER=anthropic
   export PRISMALENS_LLM_MODEL=claude-sonnet-4-20250514
   # or
   export OPENAI_API_KEY=sk-...
   export PRISMALENS_LLM_PROVIDER=openai
   export PRISMALENS_LLM_MODEL=gpt-4o
   ```

### Commands

| Command | Description | Tests |
|---------|-------------|-------|
| `pnpm eval` | Run all evaluations | All `*.eval.ts` files |
| `pnpm eval:smoke` | Quick validation | `[E2E] Graph › Smoke Test` |
| `pnpm eval:e2e` | Full graph tests | `[E2E] Graph › *` |
| `pnpm eval:agents` | Agent component tests | `[Agent] Detective/Surgeon › *` |
| `pnpm eval:tools` | Tool tests only | `[Tool] Hypothesis/Fix Proposal › *` |
| `pnpm eval:watch` | Watch mode for development | All (continuous) |

### Environment Variables

```bash
# LangSmith (required)
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=prismalens-agents-dev
LANGCHAIN_TRACING_V2=true

# LLM Configuration (unified with production)
PRISMALENS_LLM_PROVIDER=groq        # ollama | groq | anthropic | openai | google | openrouter
PRISMALENS_LLM_MODEL=llama-3.3-70b-versatile

# Ollama URL (only needed when using ollama provider)
PRISMALENS_OLLAMA_BASE_URL=http://localhost:11434

# Per-Agent Overrides (optional)
PRISMALENS_COMMANDER_PROVIDER=groq
PRISMALENS_COMMANDER_MODEL=llama-3.3-70b-versatile
PRISMALENS_DETECTIVE_PROVIDER=anthropic
PRISMALENS_DETECTIVE_MODEL=claude-sonnet-4-20250514
PRISMALENS_GATHERER_PROVIDER=groq
PRISMALENS_GATHERER_MODEL=llama-3.3-70b-versatile
PRISMALENS_SURGEON_PROVIDER=ollama
PRISMALENS_SURGEON_MODEL=qwen3-coder:30b

# Timeout Control
TEST_TIMEOUT_MS=300000              # 5 min default, increase for slow LLMs

# LLM-as-Judge (optional, costs tokens)
TEST_USE_LLM_JUDGE=false            # Set true for CI, false for local dev
TEST_JUDGE_PROVIDER=openai          # Falls back to PRISMALENS_LLM_PROVIDER
TEST_JUDGE_MODEL=gpt-4o-mini        # Falls back to PRISMALENS_LLM_MODEL
```

### LLM-as-Judge Configuration

Use a different model for judging to avoid self-judging bias:

```bash
# Local dev - fast, rule-based only
pnpm eval:debug

# CI - with semantic LLM judge
TEST_USE_LLM_JUDGE=true pnpm eval
```

**Cost Estimate:**
| Evaluator | Cost per eval |
|-----------|---------------|
| Rule-based | Free |
| Keyword match | Free |
| Enhanced trajectory | Free |
| LLM judge | ~$0.01-0.05 |

### Timeout Configuration

For slower LLMs (large local models), increase the timeout:

```bash
# 10 minutes for local 14B+ models
TEST_TIMEOUT_MS=600000 pnpm eval

# 15 minutes for very large models
TEST_TIMEOUT_MS=900000 pnpm eval
```

---

## Understanding Scenarios

### Scenario Structure

Each scenario is a self-contained test case:

```typescript
interface ScenarioDefinition {
  name: string;                           // "NullPointerException in UserService"
  difficulty: "easy" | "medium" | "hard";
  category: "code" | "config" | "infrastructure" | "external" | "unknown";

  input: {
    investigationId: string;
    incidentId: string;
    priority: "low" | "normal" | "high" | "critical";
    incident: IncidentContext;            // Title, description, severity, service
    alerts: AlertContext[];               // Related alerts with labels
  };

  expected: {
    status: "completed" | "failed";
    minConfidence: number;                // 0-100, minimum hypothesis confidence
    rootCauseCategory: string;            // Expected category
    shouldHaveRecommendations: boolean;
    rootCauseKeywords?: string[];         // Keywords that should appear
  };
}
```

### Difficulty Levels

| Difficulty | Min Confidence | Assertions | Example |
|------------|---------------|------------|---------|
| **Easy** | 60%+ | Strict category match, high hypothesis score | NullPointerException with stack trace |
| **Medium** | 40%+ | Lenient thresholds, category flexibility | Database connection pool exhaustion |
| **Hard** | 20%+ | Just verify completion and output | Race condition with intermittent failures |

### Categories

| Category | Description | Example Scenarios |
|----------|-------------|-------------------|
| `code` | Application code bugs | NullPointer, memory leak, type error |
| `config` | Configuration issues | DB pool size, timeout, resource limits |
| `infrastructure` | Infrastructure problems | OOM kill, CPU spike, disk full |
| `external` | External service issues | API timeout, third-party failure |
| `unknown` | Ambiguous or complex | Multi-factor, intermittent issues |

### Mock System

Each scenario includes embedded mocks for GitHub and Render integrations:

```typescript
interface ScenarioWithMocks extends ScenarioDefinition {
  mocks: {
    github?: {
      searchCode?: GitHubCodeSearchResult[];  // Code search results
      getFile?: Record<string, string>;       // File contents
      listCommits?: GitHubCommit[];           // Recent commits
    };
    render?: {
      getLogs?: RenderLogEntry[];             // Application logs
      listServices?: RenderService[];         // Service status
    };
  };
  solutionHint?: string;                      // What the agent should find
  tags?: string[];                            // smoke, regression, edge-case
}
```

This design ensures:
- **Isolation**: No real API calls during tests
- **Repeatability**: Same input always produces testable results
- **Speed**: No network latency or rate limiting

---

## Evaluators (Scoring)

The evaluation system provides multiple levels of assessment:

| Evaluator Type | Cost | Speed | Use Case |
|---------------|------|-------|----------|
| **Rule-based** | Free | Fast | Always run, basic quality checks |
| **Keyword Match** | Free | Fast | Ground truth comparison |
| **Enhanced Trajectory** | Free | Fast | Argument validation |
| **LLM-as-Judge** | ~$0.01-0.05/eval | Slower | Semantic quality (CI only) |
| **Unified** | Combines all | Varies | Comprehensive evaluation |

### Quick Start with Unified Evaluator

```typescript
import { evaluateInvestigationUnified } from "../evaluators/unified.evaluator.js";

// Run comprehensive evaluation
const evalResult = await evaluateInvestigationUnified(result, scenario, {
  useLLMJudge: process.env.TEST_USE_LLM_JUDGE === "true",
});

// Log to LangSmith
ls.logOutputs({
  overallScore: evalResult.overallScore,
  hypothesisScore: evalResult.ruleBased.hypothesisScore,
  keywordMatch: evalResult.ruleBased.keywordMatchScore,
  searchRelevance: evalResult.trajectory.searchRelevance,
  llmJudgeScore: evalResult.llmJudge?.overallScore,
});

// Assert threshold
expect(evalResult.overallScore).toBeGreaterThanOrEqual(60);
```

---

### Hypothesis Evaluator

Scores the quality of root cause hypotheses (0-100):

```typescript
evaluateHypothesis(hypothesis) → {
  score: number;        // 0-100 overall quality
  checks: {
    hasValidClaim: boolean;
    hasEvidence: boolean;
    hasConfidence: boolean;
    hasCategory: boolean;
    confidenceInRange: boolean;
    evidenceCount: boolean;
  };
  feedback: string[];   // Actionable improvements
}
```

**Scoring Weights:**
| Criterion | Points | Description |
|-----------|--------|-------------|
| Claim clarity | 25 | Clear, specific hypothesis statement |
| Evidence presence | 25 | Supporting evidence provided |
| Confidence calibration | 20 | Confidence score is reasonable |
| Category accuracy | 15 | Correct root cause category |
| Evidence quantity | 15 | Multiple pieces of evidence |

### Recommendation Evaluator

Scores the actionability of fix proposals (0-100):

```typescript
evaluateRecommendation(recommendation) → {
  score: number;
  checks: {
    hasTitle: boolean;
    hasDescription: boolean;
    hasCategory: boolean;
    hasPriority: boolean;
    hasVerificationSteps: boolean;
    hasRiskAssessment: boolean;
    isActionable: boolean;
  };
  feedback: string[];
}
```

**Scoring Weights:**
| Criterion | Points | Description |
|-----------|--------|-------------|
| Description | 25 | Detailed fix description |
| Verification steps | 20 | How to verify the fix works |
| Title | 15 | Clear, actionable title |
| Category | 10 | code_fix, config_change, rollback, etc. |
| Priority | 10 | high, medium, low |
| Risk assessment | 10 | Risk score and approval level |
| Actionability | 10 | Can someone execute this? |

### Trajectory Evaluator

Scores agent decision-making (which tools were called):

```typescript
evaluateTrajectory(toolCalls, options) → {
  score: number;
  requiredToolsCalled: boolean;
  missingTools: string[];
  calledTools: string[];
  feedback: string[];
}
```

**Expected Trajectories:**
| Agent | Expected Tools | Forbidden Tools |
|-------|---------------|-----------------|
| Commander | task (delegation) | form_hypothesis, propose_fix |
| Gatherer | github_search, get_file, render_logs | form_hypothesis, propose_fix |
| Detective | form_hypothesis, evaluate_hypothesis | propose_fix |
| Surgeon | propose_fix, validate_code_change | form_hypothesis |

### Enhanced Trajectory Evaluator

Validates that agents searched for and read the right things:

```typescript
evaluateTrajectoryEnhanced(toolCalls, {
  expectedSearchTerms: ["NullPointerException", "UserService"],
  expectedFilesToRead: ["UserService.java"],
  expectedEvidencePatterns: ["line\\s*\\d+"],
}) → {
  score: number;                    // Base trajectory score
  argumentRelevance: {
    searchRelevance: number;        // % of expected terms searched
    fileRelevance: number;          // % of expected files read
    evidenceCapture: number;        // % of patterns found
  };
  enhancedScore: number;            // Combined score
}
```

Add expectations to scenarios in `ExtendedExpectedOutput`:

```typescript
expected: {
  // ... existing fields ...
  expectedSearchTerms: ["NullPointerException", "UserService"],
  expectedFilesToRead: ["UserService.java", "UserController.java"],
  expectedEvidencePatterns: ["line\\s*42", "null.*check"],
}
```

### Ground Truth Evaluator

Compares agent outputs against expected answers:

```typescript
// Keyword matching (free, deterministic)
evaluateKeywordMatch(agentOutput, ["NullPointerException", "null check"]) → {
  score: number;
  matchedKeywords: string[];
  missedKeywords: string[];
}

// Semantic matching (costs tokens, more accurate)
await evaluateSemanticMatch(agentOutput, solutionHint) → {
  score: number;
  reasoning: string;
  keyInsightsMatched: string[];
  keyInsightsMissed: string[];
  falsePositives: string[];
}

// Combined evaluation
await evaluateGroundTruth(agentOutput, { rootCauseKeywords, solutionHint }) → {
  keywordScore: number;
  semanticScore?: number;  // Only if LLM judge enabled
  combinedScore: number;
}
```

### LLM-as-Judge Evaluator

Uses an LLM to semantically evaluate outputs (costs tokens):

```typescript
// Evaluate hypothesis quality
await evaluateHypothesisWithLLM(hypothesis, scenarioContext) → {
  score: number;      // 0-100
  reasoning: string;
  strengths: string[];
  weaknesses: string[];
}

// Evaluate recommendation quality
await evaluateRecommendationWithLLM(recommendation, scenarioContext) → LLMJudgeResult

// Evaluate overall investigation
await evaluateInvestigationWithLLM(result, scenarioContext) → LLMJudgeResult
```

**Configuration:**

```bash
# Enable LLM judge (default: false)
TEST_USE_LLM_JUDGE=true

# Use a different model for judging (avoids self-judging bias)
TEST_JUDGE_PROVIDER=openai
TEST_JUDGE_MODEL=gpt-4o-mini
```

**Scoring Rubric (Hypothesis):**
| Criterion | Weight | Description |
|-----------|--------|-------------|
| Correctness | 40% | Does hypothesis match expected root cause? |
| Evidence Quality | 30% | Is evidence relevant and sufficient? |
| Confidence Calibration | 20% | Is confidence level appropriate? |
| Completeness | 10% | Are all aspects addressed? |

### Unified Evaluator

Combines all evaluation methods into one interface:

```typescript
const result = await evaluateInvestigationUnified(investigationResult, scenario, {
  useLLMJudge: true,  // Enable for CI
});

// Result structure:
{
  ruleBased: {
    hypothesisScore: number;      // Rule-based hypothesis quality
    recommendationScore: number;  // Rule-based recommendation quality
    trajectoryScore: number;      // Basic trajectory score
    keywordMatchScore: number;    // Keyword matching score
  };
  llmJudge?: {                    // Only if enabled
    hypothesisScore: number;
    recommendationScore: number;
    overallScore: number;
    reasoning: string;
  };
  trajectory: {
    baseScore: number;
    searchRelevance: number;      // Enhanced: search terms
    fileRelevance: number;        // Enhanced: files read
    evidenceCapture: number;      // Enhanced: patterns found
    enhancedScore: number;
  };
  groundTruth?: {
    keywordScore: number;
    semanticScore?: number;
    combinedScore: number;
  };
  overallScore: number;           // Aggregated 0-100
  feedback: string[];             // Summary of issues
  usedLLMJudge: boolean;
}
```

**Overall Score Calculation:**
| Component | Weight |
|-----------|--------|
| Hypothesis (rule-based) | 25% |
| Recommendation (rule-based) | 15% |
| Trajectory (enhanced) | 20% |
| Ground Truth | 20% |
| LLM Judge (if enabled) | 20% |

---

## LangSmith Integration

### How It Works

1. **Test → Experiment**: Each test run becomes a LangSmith experiment
2. **Automatic Tracing**: All LLM calls are traced with full context
3. **Score Logging**: Evaluator scores are logged as feedback
4. **Human Review**: Results can be reviewed in the LangSmith UI

### Viewing Results

After running evals, view results in LangSmith:

1. Go to https://smith.langchain.com
2. Select your project (e.g., "prismalens-agents-dev")
3. Click on the experiment (test run)
4. View traces, inputs, outputs, and feedback scores

### Using the langsmith-api Skill

Query results directly from the CLI:

```bash
# List recent experiments
npx tsx ~/.claude/skills/langsmith-api/scripts/langsmith-api.ts list-experiments

# Get results for an experiment
npx tsx ~/.claude/skills/langsmith-api/scripts/langsmith-api.ts get-results --experiment "EXPERIMENT_ID"

# Compare two experiments
npx tsx ~/.claude/skills/langsmith-api/scripts/langsmith-api.ts compare --exp1 "ID1" --exp2 "ID2"

# Query failed runs
npx tsx ~/.claude/skills/langsmith-api/scripts/langsmith-api.ts failed-runs --experiment "EXPERIMENT_ID"
```

---

## Adding New Scenarios

### Step 1: Create the Scenario

Create a new file or add to an existing category:

```typescript
// evals/scenarios/my-category.scenarios.ts
import { createIncident, createAlert } from "../fixtures/index.js";
import type { ScenarioWithMocks } from "./types.js";

export const myNewScenario: ScenarioWithMocks = {
  name: "Memory leak in background job",
  difficulty: "medium",
  category: "code",
  tags: ["memory", "background-job"],

  input: {
    investigationId: "eval-memory-leak-001",
    incidentId: "inc-memory-leak-001",
    priority: "high",

    incident: createIncident({
      title: "High memory usage in worker service",
      description: "Worker pods are getting OOM killed every 4 hours",
      severity: "high",
      serviceName: "background-worker",
    }),

    alerts: [
      createAlert({
        name: "HighMemoryUsage",
        message: "Memory usage above 90% for 15 minutes",
        severity: "warning",
        annotations: {
          pod: "worker-abc123",
          memory_usage: "92%",
        },
      }),
      createAlert({
        name: "OOMKilled",
        message: "Container was OOM killed",
        severity: "critical",
        annotations: {
          exit_code: "137",
          restart_count: "5",
        },
      }),
    ],
  },

  expected: {
    status: "completed",
    minConfidence: 50,
    rootCauseCategory: "code",
    shouldHaveRecommendations: true,
    rootCauseKeywords: ["memory", "leak", "unbounded", "cache"],
  },

  mocks: {
    github: {
      searchCode: [
        {
          path: "src/workers/JobProcessor.ts",
          repository: { full_name: "org/repo" },
          text_matches: [
            { fragment: "this.cache.set(jobId, result)" }
          ],
        },
      ],
      getFile: {
        "src/workers/JobProcessor.ts": `
          class JobProcessor {
            private cache = new Map();

            async process(job: Job) {
              const result = await this.execute(job);
              // BUG: Never clears old entries
              this.cache.set(job.id, result);
              return result;
            }
          }
        `,
      },
      listCommits: [
        {
          sha: "abc123",
          commit: {
            message: "Add caching to job processor",
            author: { date: "2024-01-10T10:00:00Z" },
          },
        },
      ],
    },
    render: {
      getLogs: [
        {
          timestamp: "2024-01-15T14:30:00Z",
          level: "warn",
          message: "Memory usage: 4.2GB / 4.5GB",
        },
        {
          timestamp: "2024-01-15T14:35:00Z",
          level: "error",
          message: "Container killed: OOMKilled",
        },
      ],
    },
  },

  solutionHint: "Agent should find unbounded cache growth in JobProcessor",
};

export const myScenarios = [myNewScenario];
export const easyMyScenarios: ScenarioWithMocks[] = [];
export const mediumMyScenarios = [myNewScenario];
export const hardMyScenarios: ScenarioWithMocks[] = [];
```

### Step 2: Export from Index

```typescript
// evals/scenarios/index.ts
export * from "./my-category.scenarios.js";

import { myScenarios } from "./my-category.scenarios.js";

export const allScenarios = [
  ...codeBugScenarios,
  ...configIssueScenarios,
  ...infrastructureScenarios,
  ...myScenarios,  // Add here
];
```

### Step 3: Run Your Scenario

```bash
# Run just your new scenario
pnpm eval -- --testNamePattern="Memory leak"

# Or run all medium scenarios
pnpm eval -- --testNamePattern="Medium"
```

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `LANGSMITH_API_KEY not set` | Missing API key | `export LANGSMITH_API_KEY=lsv2_pt_...` |
| `Connection refused localhost:11434` | Ollama not running | `ollama serve` |
| `Model not found` | Model not pulled | `ollama pull qwen3:14b` |
| `Test timeout exceeded` | LLM too slow | Increase `TEST_TIMEOUT_MS` |
| `Rate limit exceeded` | Too many API calls | Use local Ollama or slow down |

### Timeout Issues

If tests timeout frequently:

```bash
# Check your model speed
time ollama run qwen3:14b "Hello"

# Use a faster model
export PRISMALENS_LLM_MODEL=qwen3:4b

# Or increase timeout
export TEST_TIMEOUT_MS=900000  # 15 minutes
```

### LLM Provider Issues

**Groq rate limits:**
- Free tier: 30 requests/min, 100K tokens/day
- Solution: Use mixed providers (Groq for fast agents, local for others)

**Ollama slow:**
- Check VRAM: `nvidia-smi`
- Use smaller model: `PRISMALENS_LLM_MODEL=qwen3:8b`
- Ensure GPU is detected: `ollama run qwen3:14b` should show GPU usage

### Debugging a Failing Test

1. **Run single test:**
   ```bash
   pnpm eval:debug
   ```

2. **Check LangSmith traces:**
   - Go to https://smith.langchain.com
   - Find the failed run
   - Inspect inputs, outputs, and tool calls

3. **Add logging:**
   ```typescript
   console.log("Investigation result:", JSON.stringify(result, null, 2));
   ```

4. **Check mock data:**
   - Ensure mocks match what the agent expects
   - Verify mock files contain the "smoking gun" evidence

---

## Test Output Reference

### Investigation Result

```typescript
interface InvestigationResult {
  status: "completed" | "failed";
  confidence: number | null;           // 0-100
  rootCauseCategory: string | null;
  rootCause: string | null;            // Detailed explanation
  hypotheses: Hypothesis[];
  recommendations: Recommendation[];
  summary: string;
}
```

### Hypothesis

```typescript
interface Hypothesis {
  claim: string;                       // "The NPE is caused by..."
  confidence: number;                  // 0-100
  evidence: string[];                  // Supporting evidence
  category?: string;                   // code, config, infrastructure
}
```

### Recommendation

```typescript
interface Recommendation {
  title: string;                       // "Add null check in UserService"
  description: string;                 // Detailed fix description
  category?: string;                   // code_fix, config_change, rollback
  priority?: string;                   // high, medium, low
  verificationSteps?: string[];        // How to verify the fix
  riskScore?: number;                  // 0-100
  approvalLevel?: string;              // standard, peer_review, cto
}
```

---

## Summary

| Aspect | Details |
|--------|---------|
| **Architecture** | 3-level: Component → Tool → Graph |
| **Scenarios** | 20+ across code, config, infrastructure |
| **Difficulty** | Easy (strict), Medium (lenient), Hard (completion only) |
| **Evaluators** | Hypothesis (0-100), Recommendation (0-100), Trajectory |
| **LLM Support** | Ollama, Groq, Anthropic, OpenAI, Google |
| **Mocking** | Self-contained GitHub + Render mocks per scenario |
| **Tracing** | Full LangSmith integration |
| **Run Time** | 5-60 min depending on scope and LLM |
