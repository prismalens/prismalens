# Testing Strategy Plan: @prismalens/agents

## Executive Summary

This plan establishes a comprehensive testing strategy for the PrismaLens agents package, covering quality evaluation, integration testing, and component isolation with real LLM calls.

**Recommendation: Enhanced LangSmith + AgentEvals**

After researching LangSmith, DeepEval, and other options, I recommend **staying with LangSmith** and enhancing the current setup. Here's why:

| Criteria | LangSmith | DeepEval |
|----------|-----------|----------|
| LangGraph Integration | Native, first-class | Limited (only TaskCompletion metric) |
| Trajectory Evaluation | AgentEvals package | Requires custom tracing setup |
| Existing Setup | Already configured | Would need migration |
| Debugging | LangGraph Studio v2 | No visual debugger |
| Cost | Free tier (5k traces/month) | Free (self-hosted) |
| Agent Metrics | Trajectory matching, LLM-as-judge | PlanQuality, ToolCorrectness |

**Key insight**: DeepEval's LangGraph integration is limited to `TaskCompletionMetric` only. For other metrics, you'd need to manually set up tracing. Since you're already in the LangChain ecosystem, enhancing LangSmith is the more practical path.

---

## LangSmith UI Benefits & Setup

LangSmith provides a robust web UI that significantly enhances the testing and debugging experience. Here's what you get and what's needed to set it up:

### Key UI Features

#### 1. **LangGraph Studio (Agent IDE)**
Interactive debugging environment specifically for agent development.

| Feature | Benefit for PrismaLens |
|---------|------------------------|
| **Time Travel Debugging** | Step through Commander → Cartographer → Detective → Surgeon execution, inspect state at any point |
| **State Editing** | Modify investigation state mid-execution to test "what if" scenarios |
| **Fork & Replay** | Branch from any checkpoint to try different agent responses |
| **Visual Graph** | See your investigation flow as an interactive diagram |

**Setup Required**: Already configured in `langgraph.json`. Just run:
```bash
pnpm --filter @prismalens/agents build
# Then via VS Code task: "Agents: LangSmith Studio"
```

#### 2. **Traces Dashboard**
Production observability with hierarchical trace visualization.

| Feature | Benefit for PrismaLens |
|---------|------------------------|
| **Nested Traces** | See Commander's delegation to subagents as nested spans |
| **Token/Cost Tracking** | Monitor per-investigation costs |
| **Latency Analysis** | Identify slow nodes (preGather, tool calls) |
| **Error Drill-down** | Click any failed step to see full context |

**Setup Required**: Enable tracing (already in your config schema):
```bash
LANGSMITH_API_KEY=lsv2_xxx
LANGSMITH_TRACING=true
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=prismalens-agents-dev
```

#### 3. **Datasets & Experiments**
Systematic evaluation tracking with regression detection.

| Feature | Benefit for PrismaLens |
|---------|------------------------|
| **Dataset Management** | Store incident scenarios as reusable test cases |
| **Experiment Comparison** | Compare agent quality across code changes |
| **Regression Alerts** | Get notified when quality drops |
| **Export to Training** | Use good examples to fine-tune prompts |

**Setup Required**: Vitest integration (already configured). Datasets auto-created on first eval run.

#### 4. **Annotation Queues (Human Evaluation)**
Structured human review for quality assurance.

| Feature | Benefit for PrismaLens |
|---------|------------------------|
| **Single-run Queues** | Rate individual investigation outputs on rubrics |
| **Pairwise Comparison** | A/B test different prompts or models |
| **SME Assignment** | Route complex incidents to domain experts |
| **Feedback Loop** | Corrections flow back to datasets |

**Setup Required**: Create queues in LangSmith UI → Annotation Queues → New Queue. Define rubrics like:
- Hypothesis accuracy (1-5)
- Evidence quality (1-5)
- Recommendation actionability (1-5)

#### 5. **Insights Agent (Production Monitoring)**
AI-powered analysis of production usage patterns.

| Feature | Benefit for PrismaLens |
|---------|------------------------|
| **Usage Pattern Discovery** | See what types of incidents are investigated most |
| **Failure Mode Analysis** | Auto-categorize why investigations fail |
| **Trend Detection** | Spot emerging issues before they escalate |

**Setup Required**: Available on Plus/Enterprise plans. Enable after you have production traffic.

#### 6. **Multi-turn Evals (Agent Conversations)**
Evaluate complete investigation flows, not just individual steps.

| Feature | Benefit for PrismaLens |
|---------|------------------------|
| **Semantic Intent** | Did the agent understand the incident correctly? |
| **Semantic Outcomes** | Was the root cause actually identified? |
| **Trajectory Scoring** | Were the tool calls appropriate? |

**Setup Required**: Configure online evaluations in LangSmith UI with scoring prompts.

### What You Already Have

Your codebase already has:
- ✅ `langsmithSchema` in `@prismalens/config` with all required env vars
- ✅ `vitest.eval.config.ts` with LangSmith reporter
- ✅ `langgraph.json` pointing to `studio.ts`
- ✅ VS Code tasks for LangGraph Studio

### What's Missing (Setup Checklist)

| Item | Status | Action |
|------|--------|--------|
| LangSmith API Key | ❓ | Get from https://smith.langchain.com → Settings → API Keys |
| LLM API Key (Groq) | ❓ | Get from https://console.groq.com/keys (free) |
| `.env` file | ❓ | Create `packages/@prismalens/agents/.env` with keys |
| Annotation Queue | ❌ | Create in LangSmith UI after first traces |
| Datasets | ❌ | Auto-created on first `pnpm eval` run |

### Minimal .env Setup

```bash
# packages/@prismalens/agents/.env

# LangSmith (required for UI features)
LANGSMITH_API_KEY=lsv2_pt_xxxx
LANGSMITH_TRACING=true
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=prismalens-agents-dev

# LLM Provider (Groq = free, fast)
PRISMALENS_LLM_PROVIDER=groq
GROQ_API_KEY=gsk_xxxx
```

### Verification Commands

```bash
# 1. Verify tracing works
pnpm --filter @prismalens/agents eval:debug
# Check https://smith.langchain.com for traces

# 2. Verify Studio works
# VS Code: Ctrl+Shift+P → "Tasks: Run Task" → "Agents: LangSmith Studio"
# Open: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

# 3. Run full evaluations
pnpm --filter @prismalens/agents eval
# Check Datasets & Experiments in LangSmith UI
```

---

## Architecture Overview

```
Testing Pyramid
================

                    ┌─────────────────────┐
                    │    E2E Graph        │  ← Full investigation flow
                    │    Evaluations      │    (2-3 scenarios)
                    └─────────────────────┘
               ┌─────────────────────────────────┐
               │      SubAgent Evaluations       │  ← Cartographer, Detective, Surgeon
               │      (Component Level)          │    (3-5 scenarios each)
               └─────────────────────────────────┘
          ┌─────────────────────────────────────────────┐
          │          Node & Tool Tests                  │  ← preGather, validation, tools
          │          (Integration Level)                │    (unit-like, focused)
          └─────────────────────────────────────────────┘
     ┌─────────────────────────────────────────────────────────┐
     │                  Fixtures & Factories                   │  ← Reusable test data
     └─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (Test Infrastructure)

### 1.1 Directory Structure

```
packages/@prismalens/agents/
├── evals/
│   ├── fixtures/                    # Test data factories
│   │   ├── incidents.ts             # Incident/alert factories
│   │   ├── integrations.ts          # Mock integration contexts
│   │   └── index.ts
│   ├── evaluators/                  # Custom evaluators
│   │   ├── hypothesis.evaluator.ts  # Hypothesis quality scoring
│   │   ├── trajectory.evaluator.ts  # Agent trajectory validation
│   │   ├── recommendation.evaluator.ts
│   │   └── index.ts
│   ├── scenarios/                   # Test scenario definitions
│   │   ├── code-bugs.scenarios.ts   # NullPointer, type errors, etc.
│   │   ├── config-issues.scenarios.ts
│   │   ├── infrastructure.scenarios.ts
│   │   └── index.ts
│   ├── components/                  # Component-level tests
│   │   ├── cartographer.eval.ts     # Cartographer subagent
│   │   ├── detective.eval.ts        # Detective subagent
│   │   ├── surgeon.eval.ts          # Surgeon subagent
│   │   └── pre-gather.eval.ts       # Pre-gathering node
│   ├── graph/                       # Full graph tests
│   │   └── investigation.eval.ts    # E2E investigation flow
│   └── tools/                       # Tool integration tests
│       ├── hypothesis-tools.eval.ts
│       └── fix-proposal-tools.eval.ts
├── vitest.eval.config.ts            # Eval config (existing)
└── vitest.unit.config.ts            # Unit test config (new)
```

### 1.2 Dependencies to Add

```json
{
  "devDependencies": {
    "agentevals": "^0.1.0",           // Trajectory evaluators
    "@faker-js/faker": "^9.3.0",      // Already present
    "langsmith": "^0.3.0"             // Already present
  }
}
```

### 1.3 Test Configuration Split

Create separate configs for different test types:

**vitest.eval.config.ts** (existing - E2E evaluations)
- Uses LangSmith reporter
- Long timeouts (3 min)
- Sequential execution
- Real LLM calls

**vitest.unit.config.ts** (new - fast integration tests)
- Standard vitest reporter
- Short timeouts
- Parallel execution
- Mocked dependencies where needed

---

## Phase 2: Fixtures & Factories

### 2.1 Incident Factory

```typescript
// evals/fixtures/incidents.ts
import { faker } from "@faker-js/faker";

export interface ScenarioDefinition {
  name: string;
  difficulty: "easy" | "medium" | "hard";
  category: "code" | "config" | "infrastructure" | "external";
  incident: IncidentContext;
  alerts: AlertContext[];
  expected: {
    minConfidence: number;
    rootCauseCategory: string;
    shouldHaveRecommendations: boolean;
  };
}

export function createCodeBugScenario(overrides?: Partial<ScenarioDefinition>): ScenarioDefinition;
export function createConfigScenario(overrides?: Partial<ScenarioDefinition>): ScenarioDefinition;
export function createInfraScenario(overrides?: Partial<ScenarioDefinition>): ScenarioDefinition;
```

### 2.2 Integration Mocks

```typescript
// evals/fixtures/integrations.ts

/**
 * Mock integrations that return canned responses.
 * Use for testing agent behavior without real API calls.
 */
export const mockGitHubIntegration = {
  type: "github" as const,
  connectionId: "mock-github",
  credentials: { token: "mock-token" },
  config: { owner: "test-org", repo: "test-repo" },
};

export const mockRenderIntegration = {
  type: "render" as const,
  connectionId: "mock-render",
  credentials: { apiKey: "mock-key" },
  config: { serviceId: "srv-123" },
};
```

---

## Phase 3: Custom Evaluators

### 3.1 Hypothesis Quality Evaluator

```typescript
// evals/evaluators/hypothesis.evaluator.ts
import { createTrajectoryLlmAsJudge } from "agentevals";

/**
 * Evaluates hypothesis quality using LLM-as-judge.
 * Checks: confidence calibration, evidence citation, category accuracy
 */
export const hypothesisQualityEvaluator = createTrajectoryLlmAsJudge({
  prompt: `You are evaluating an incident investigation hypothesis.

  Given:
  - Incident: {incident_title}
  - Expected category: {expected_category}
  - Hypothesis: {hypothesis}

  Rate the hypothesis on:
  1. Evidence quality (0-100): Is the hypothesis supported by cited evidence?
  2. Confidence calibration (0-100): Is the confidence level appropriate?
  3. Actionability (0-100): Does it point to a specific root cause?

  Return JSON: { "evidence": N, "calibration": N, "actionability": N, "reasoning": "..." }`,
  model: "gpt-4o-mini", // Cheap, fast judge
});
```

### 3.2 Trajectory Match Evaluator

```typescript
// evals/evaluators/trajectory.evaluator.ts
import { createTrajectoryMatchEvaluator } from "agentevals";

/**
 * Validates that agents follow expected workflow patterns.
 * Mode: "subset" - agent must call at least these tools
 */
export const investigationTrajectoryEvaluator = createTrajectoryMatchEvaluator({
  trajectoryMatchMode: "subset",
  toolArgsMatchMode: "ignore", // Focus on tool selection, not args
});

// Expected trajectory for a successful investigation
export const expectedInvestigationTrajectory = [
  { tool: "task", args: { subagent: "cartographer" } },
  { tool: "task", args: { subagent: "detective" } },
  // Surgeon only if confidence >= 70%
];
```

### 3.3 Recommendation Evaluator

```typescript
// evals/evaluators/recommendation.evaluator.ts

/**
 * Validates fix recommendations have required structure.
 */
export function validateRecommendation(rec: Recommendation): EvaluationResult {
  const checks = {
    hasTitle: Boolean(rec.title),
    hasDescription: Boolean(rec.description),
    hasRiskScore: typeof rec.riskScore === "number",
    hasVerificationSteps: Array.isArray(rec.verificationSteps),
    hasApprovalLevel: ["low", "medium", "high", "critical"].includes(rec.approvalLevel),
  };

  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  return { score, checks };
}
```

---

## Phase 4: Component-Level Tests

### 4.1 Cartographer Subagent Tests

```typescript
// evals/components/cartographer.eval.ts
import * as ls from "langsmith/vitest";
import { createSubAgents } from "../../src/agents/subagents";

ls.describe("Cartographer SubAgent", () => {
  ls.test("gathers logs when deployment platform available", {
    inputs: { task: "Find recent deployment logs for api-server" },
  }, async ({ inputs }) => {
    const { cartographer } = createSubAgents({ integrations: [mockRenderIntegration] });
    const result = await cartographer.invoke({ messages: [{ role: "user", content: inputs.task }] });

    ls.logOutputs({ toolsCalled: extractToolCalls(result), summary: result.messages.at(-1)?.content });

    // Validate it attempted to use log-analysis skill
    expect(extractToolCalls(result)).toContainEqual(expect.objectContaining({ name: "log_analysis" }));
  });

  ls.test("searches code when repository available", { /* ... */ });
  ls.test("gracefully degrades when no integrations", { /* ... */ });
});
```

### 4.2 Detective Subagent Tests

```typescript
// evals/components/detective.eval.ts

ls.describe("Detective SubAgent", () => {
  ls.test("forms hypothesis with evidence", { /* ... */ });
  ls.test("correlates with recent changes", { /* ... */ });
  ls.test("confidence calibration is reasonable", { /* ... */ });
  ls.test("rejects hypothesis when evidence contradicts", { /* ... */ });
});
```

### 4.3 Surgeon Subagent Tests

```typescript
// evals/components/surgeon.eval.ts

ls.describe("Surgeon SubAgent", () => {
  ls.test("proposes rollback for recent deployment", { /* ... */ });
  ls.test("includes risk assessment", { /* ... */ });
  ls.test("looks up runbooks when available", { /* ... */ });
  ls.test("requires approval for high-risk fixes", { /* ... */ });
});
```

### 4.4 Pre-Gather Node Tests

```typescript
// evals/components/pre-gather.eval.ts

ls.describe("Pre-Gather Node", () => {
  ls.test("fetches all sources in parallel", { /* ... */ });
  ls.test("calculates risk scores for deployments", { /* ... */ });
  ls.test("finds similar incidents", { /* ... */ });
  ls.test("gracefully handles partial failures", { /* ... */ });
});
```

---

## Phase 5: E2E Graph Evaluations

### 5.1 Scenario Categories

| Category | Scenarios | Difficulty | Key Assertions |
|----------|-----------|------------|----------------|
| **Code Bugs** | NullPointer, TypeErrors, OutOfBounds | Easy | Category=code, confidence>70% |
| **Config Issues** | DB connection, rate limits, feature flags | Medium | Category=config, has config change in evidence |
| **Infrastructure** | Memory, CPU, disk, network | Medium | Category=infra, mentions metrics |
| **Cascading** | Multi-service failures | Hard | Multiple hypotheses, dependency awareness |
| **Ambiguous** | Intermittent issues, race conditions | Hard | Appropriate low confidence |

### 5.2 Full Investigation Test

```typescript
// evals/graph/investigation.eval.ts

ls.describe("Investigation E2E", () => {
  for (const scenario of allScenarios) {
    ls.test(scenario.name, {
      inputs: scenario.input,
      referenceOutputs: scenario.expected,
    }, async ({ inputs, referenceOutputs }) => {
      const graph = await getGraph();
      const result = await graph.invoke(inputs);

      // Log for LangSmith
      ls.logOutputs({
        status: result.status,
        confidence: result.confidence,
        rootCauseCategory: result.rootCauseCategory,
        hypothesesCount: result.hypotheses?.length,
        recommendationsCount: result.recommendations?.length,
        trajectory: extractTrajectory(result),
      });

      // Quality assertions
      expect(result.status).toBe("completed");
      expect(result.confidence).toBeGreaterThanOrEqual(referenceOutputs.minConfidence);

      // Trajectory assertion (using agentevals)
      const trajectoryResult = await investigationTrajectoryEvaluator.evaluate({
        input: inputs,
        output: result,
        referenceTrajectory: getExpectedTrajectory(scenario),
      });
      expect(trajectoryResult.score).toBeGreaterThan(0.7);

      // Hypothesis quality assertion
      if (result.hypotheses?.length > 0) {
        const hypQuality = await hypothesisQualityEvaluator.evaluate({
          hypothesis: result.hypotheses[0],
          expected_category: referenceOutputs.category,
        });
        expect(hypQuality.score).toBeGreaterThan(0.6);
      }
    });
  }
});
```

---

## Phase 6: Tool Integration Tests

### 6.1 Hypothesis Tools

```typescript
// evals/tools/hypothesis-tools.eval.ts

describe("Hypothesis Tools", () => {
  test("form_hypothesis stores to global store", async () => {
    resetHypothesisStore();
    const tool = createFormHypothesisTool();

    await tool.invoke({
      claim: "NullPointerException in UserService",
      confidence: 85,
      evidence: ["Stack trace shows null userId"],
      category: "code",
    });

    const stored = getStoredHypotheses();
    expect(stored).toHaveLength(1);
    expect(stored[0].confidence).toBe(85);
  });

  test("evaluate_hypothesis updates existing", async () => { /* ... */ });
  test("correlate_with_changes adds change context", async () => { /* ... */ });
});
```

### 6.2 Fix Proposal Tools

```typescript
// evals/tools/fix-proposal-tools.eval.ts

describe("Fix Proposal Tools", () => {
  test("propose_fix validates code blocks exist", async () => { /* ... */ });
  test("suggest_rollback requires recent deployment", async () => { /* ... */ });
  test("assess_change_risk calculates proper score", async () => { /* ... */ });
});
```

---

## Phase 7: Scripts & Commands

### 7.1 Package.json Scripts

```json
{
  "scripts": {
    "eval": "vitest run --config vitest.eval.config.ts",
    "eval:watch": "vitest --config vitest.eval.config.ts",
    "eval:debug": "vitest run --config vitest.eval.config.ts -t 'Debug'",
    "eval:components": "vitest run --config vitest.eval.config.ts evals/components",
    "eval:graph": "vitest run --config vitest.eval.config.ts evals/graph",
    "test:tools": "vitest run --config vitest.unit.config.ts evals/tools"
  }
}
```

---

## Phase 8: LangSmith Dataset Management

### 8.1 Dataset Creation

```typescript
// scripts/seed-langsmith-datasets.ts
import { Client } from "langsmith";
import { allScenarios } from "../evals/scenarios";

async function seedDatasets() {
  const client = new Client();

  // Create dataset for each category
  for (const category of ["code-bugs", "config-issues", "infrastructure"]) {
    const scenarios = allScenarios.filter(s => s.category === category);

    await client.createDataset(`prismalens-agents-${category}`, {
      description: `${category} investigation scenarios`,
    });

    for (const scenario of scenarios) {
      await client.createExample(scenario.input, scenario.expected, {
        datasetName: `prismalens-agents-${category}`,
      });
    }
  }
}
```

### 8.2 Regression Tracking

LangSmith automatically tracks experiments over time. Each eval run creates a new experiment linked to the dataset. Use the LangSmith UI to:

1. Compare experiments across commits
2. Identify regressions in quality metrics
3. Track confidence calibration drift

---

## Phase 9: LangSmith UI Workflow

### 9.1 Daily Development Workflow

```
Developer Loop
==============

1. Write/modify agent code
         ↓
2. Run `pnpm eval:debug` (single scenario)
         ↓
3. Check LangSmith trace for issues
   - Click failing span → see full context
   - Use "Playground" to tweak prompts
         ↓
4. Use LangGraph Studio for complex debugging
   - Time travel to problematic step
   - Edit state and replay
         ↓
5. Run full `pnpm eval` before commit
         ↓
6. Compare experiments in LangSmith UI
   - Did quality improve?
   - Any regressions?
```

### 9.2 Quality Review Workflow (Using Annotation Queues)

```
Weekly Quality Review
=====================

1. Sample production traces
   LangSmith UI → Traces → Filter by "investigation" → Sample 10-20
         ↓
2. Add to Annotation Queue
   Select traces → Actions → Add to Queue → "Weekly Review"
         ↓
3. SME reviews with rubric
   - Hypothesis accuracy: 1-5
   - Evidence citation: 1-5
   - Recommendation quality: 1-5
   - Would you trust this? Yes/No
         ↓
4. Analyze feedback
   LangSmith UI → Annotation Queue → Export results
         ↓
5. Improve based on patterns
   - Low hypothesis scores → improve Detective prompt
   - Missing evidence → add more tools to Cartographer
   - Bad recommendations → enhance Surgeon skills
```

### 9.3 Setting Up Annotation Queue (Step by Step)

1. **Create Queue**: LangSmith UI → Annotation Queues → Create Queue
   - Name: `investigation-quality-review`
   - Description: "Weekly review of investigation outputs"

2. **Define Rubric**:
   ```
   Criteria 1: Hypothesis Quality (1-5)
   - 5: Correct root cause with strong evidence
   - 4: Likely correct, good evidence
   - 3: Plausible but needs more investigation
   - 2: Weak hypothesis, poor evidence
   - 1: Incorrect or no hypothesis

   Criteria 2: Recommendation Actionability (1-5)
   - 5: Clear fix with verification steps
   - 4: Good recommendation, minor gaps
   - 3: General direction, needs details
   - 2: Vague or risky recommendation
   - 1: No recommendation or harmful

   Criteria 3: Overall Trust (Yes/No)
   - Would you trust this investigation to help resolve the incident?
   ```

3. **Assign Reviewers**: Add team members who understand incident response

4. **Sampling Strategy**: Add 5-10 traces per week from production (or evaluation runs)

### 9.4 Experiment Comparison Workflow

When comparing two versions of your agents:

1. Run baseline: `pnpm eval` (commit A)
2. Make changes, run again: `pnpm eval` (commit B)
3. In LangSmith UI:
   - Go to Datasets & Experiments
   - Select your dataset (e.g., `prismalens-agents-code-bugs`)
   - Click "Compare Experiments"
   - Select both experiment runs
   - View side-by-side metrics

**Key Metrics to Compare**:
- Pass rate (% of tests passing assertions)
- Confidence distribution (are scores calibrated?)
- Latency (p50, p95)
- Token usage (cost per investigation)

### 9.5 No-Code Evaluation in Studio

LangGraph Studio v2 allows running evaluations without code:

1. Open Studio with your investigation graph
2. Provide test input (incident + alerts)
3. Click "Run"
4. Studio shows step-by-step execution
5. Click "Evaluate" to grade against criteria
6. Define custom rubrics in the UI
7. Results saved to LangSmith for tracking

This is useful for:
- Quick ad-hoc testing of new scenarios
- Demonstrating agent behavior to stakeholders
- Debugging specific failure cases

---

## Implementation Order

### Week 1: Foundation
1. [ ] Create directory structure
2. [ ] Install `agentevals` package
3. [ ] Create fixtures/factories
4. [ ] Migrate existing scenarios to new structure

### Week 2: Component Tests
5. [ ] Implement Cartographer evaluations (3-5 scenarios)
6. [ ] Implement Detective evaluations (3-5 scenarios)
7. [ ] Implement Surgeon evaluations (3-5 scenarios)
8. [ ] Implement pre-gather node tests

### Week 3: Evaluators & E2E
9. [ ] Implement custom evaluators (hypothesis, trajectory, recommendation)
10. [ ] Expand E2E scenarios (10+ covering all categories)
11. [ ] Add tool integration tests

### Week 4: Polish & Documentation
12. [ ] Seed LangSmith datasets
13. [ ] Document evaluation process in README ✅
14. [ ] Set up annotation queue rubrics
15. [ ] Add regression alerting (optional)

---

## Tool Execution Strategy

**Decision: Single Source of Truth (Database) + Real External APIs**

Evals use the **same code path as production** with a dedicated test database:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SINGLE SOURCE OF TRUTH: Database                        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  test.db (SQLite)                                                    │  │
│   │  └── IntegrationConnection (seeded with real credentials)           │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│              oRPC: integrationsContract.listConnections()                   │
│                              │                                              │
│                              ▼                                              │
│                    IntegrationContext[]                                     │
│                              │                                              │
│         ┌────────────────────┼────────────────────┐                        │
│         ▼                    ▼                    ▼                        │
│   ┌───────────┐       ┌───────────┐       ┌───────────┐                   │
│   │    MCP    │       │   Tools   │       │  Agents   │                   │
│   │  Servers  │       │           │       │           │                   │
│   └───────────┘       └───────────┘       └───────────┘                   │
│         │                    │                    │                        │
└─────────┼────────────────────┼────────────────────┼────────────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼ REAL HTTP calls
                    ┌────────────────────────────┐
                    │ External APIs              │
                    │ (GitHub, Render, etc.)     │
                    └────────────────────────────┘
```

**What's different in evals**: Uses `test.db` instead of production database, seeded with integration credentials from CI secrets.

**What's the same**: Full production code path (DB → oRPC → IntegrationContext → Tools → External APIs).

### Test Database Setup

```typescript
// evals/setup/seed-integrations.ts
import { PrismaClient } from "@prismalens/database";
import { encrypt } from "@prismalens/database/encryption";

/**
 * Seed test database with integration connections.
 * Credentials come from CI secrets (environment variables).
 * These env vars are ONLY used for seeding, not by the app directly.
 */
export async function seedTestIntegrations(prisma: PrismaClient) {
  // Get GitHub integration definition
  const githubDef = await prisma.integrationDefinition.findFirst({
    where: { name: "github" },
  });

  if (githubDef && process.env.TEST_GITHUB_TOKEN) {
    await prisma.integrationConnection.upsert({
      where: { id: "test-github-connection" },
      create: {
        id: "test-github-connection",
        definitionId: githubDef.id,
        name: "Test GitHub",
        isGlobal: true,
        status: "connected",
        authMethod: "api_key",
        credentials: encrypt({
          accessToken: process.env.TEST_GITHUB_TOKEN,
        }),
        config: {
          owner: process.env.TEST_GITHUB_OWNER || "prismalens-org",
          repo: process.env.TEST_GITHUB_REPO || "prismalens",
        },
      },
      update: {
        credentials: encrypt({
          accessToken: process.env.TEST_GITHUB_TOKEN,
        }),
      },
    });
  }

  // Render integration (optional)
  const renderDef = await prisma.integrationDefinition.findFirst({
    where: { name: "render" },
  });

  if (renderDef && process.env.TEST_RENDER_API_KEY) {
    await prisma.integrationConnection.upsert({
      where: { id: "test-render-connection" },
      create: {
        id: "test-render-connection",
        definitionId: renderDef.id,
        name: "Test Render",
        isGlobal: true,
        status: "connected",
        authMethod: "api_key",
        credentials: encrypt({
          apiKey: process.env.TEST_RENDER_API_KEY,
        }),
        config: {
          serviceId: process.env.TEST_RENDER_SERVICE_ID,
        },
      },
      update: {
        credentials: encrypt({
          apiKey: process.env.TEST_RENDER_API_KEY,
        }),
      },
    });
  }
}
```

### Vitest Setup

```typescript
// evals/setup/vitest.setup.ts
import { PrismaClient } from "@prismalens/database";
import { seedTestIntegrations } from "./seed-integrations.js";

// Use test database
process.env.DATABASE_URL = "file:./test.db";

const prisma = new PrismaClient();

beforeAll(async () => {
  // Run migrations on test DB
  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

  // Seed integrations
  await seedTestIntegrations(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

### CI Secrets (GitHub Actions)

```yaml
# .github/workflows/agents-eval.yml (when CI is added)
env:
  # These are used ONLY for seeding test.db, not by app directly
  TEST_GITHUB_TOKEN: ${{ secrets.TEST_GITHUB_TOKEN }}
  TEST_GITHUB_OWNER: prismalens-org
  TEST_GITHUB_REPO: prismalens
  TEST_RENDER_API_KEY: ${{ secrets.TEST_RENDER_API_KEY }}
  TEST_RENDER_SERVICE_ID: ${{ secrets.TEST_RENDER_SERVICE_ID }}
```

### Local Development

For local eval runs without CI secrets:

```bash
# packages/@prismalens/agents/.env.test
TEST_GITHUB_TOKEN=ghp_xxx    # Your personal token (repo scope)
TEST_GITHUB_OWNER=your-org
TEST_GITHUB_REPO=your-repo
```

### Graceful Degradation

Tests still pass without integrations (agent uses incident context only):

```typescript
ls.test("investigates with available tools", async ({ inputs }) => {
  // Fetch integrations via oRPC (same as production)
  const integrations = await integrationsClient.listConnections({});

  if (integrations.length === 0) {
    console.warn("[Eval] No integrations in test.db - agent uses context only");
  }

  const result = await executeInvestigation({
    ...inputs,
    integrations: integrations.map(mapToIntegrationContext),
  });

  // Core assertions always apply
  expect(result.status).toBe("completed");
  expect(result.confidence).toBeGreaterThanOrEqual(referenceOutputs.minConfidence);

  // Integration-specific assertions only if available
  const hasGitHub = integrations.some(i => i.definition?.name === "github");
  if (hasGitHub) {
    expect(result.dataSourcesUsed).toContain("github");
  }
});
```

### Rate Limit Handling

Since we're making real API calls:

```typescript
// vitest.eval.config.ts
export default defineConfig({
  test: {
    // Sequential execution to avoid rate limits
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    // Generous timeouts for real API calls
    testTimeout: 300000, // 5 min per test
    sequence: {
      shuffle: false,
    },
    // Use test setup
    setupFiles: ["./evals/setup/vitest.setup.ts"],
  },
});
```

---

## Cost Estimates

| Test Type | Scenarios | LLM Calls/Run | API Calls | Monthly Cost |
|-----------|-----------|---------------|-----------|--------------|
| E2E Graph | 10 | ~50 | GitHub: ~30, Render: ~10 | Groq: Free, GitHub: Free tier |
| Component | 15 | ~30 | ~20 | Free |
| Tool Tests | 10 | 0 | 0 (unit tests) | $0 |
| **Total** | **35** | **~80** | **~60** | **Free** |

Groq free tier: 30 req/min, 100k tokens/day - sufficient for daily runs.
GitHub API: 5000 req/hour (authenticated) - more than enough.

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test Coverage | >80% of agent paths | LangSmith trajectory analysis |
| Confidence Calibration | Within 15% of actual | Compare predicted vs actual success |
| Root Cause Accuracy | >70% correct category | Manual review of samples |
| Recommendation Quality | >60% actionable | LLM-as-judge scoring |
| Regression Rate | <5% per release | LangSmith experiment comparison |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LLM non-determinism | Run multiple times, track variance |
| Rate limits | Sequential execution, Groq free tier |
| Flaky tests | Generous thresholds, retry logic |
| Dataset drift | Regular scenario review, prod trace sampling |
| Cost escalation | Start with Groq, only upgrade for prod eval |

---

## Questions Resolved

1. **LangSmith vs DeepEval?** → LangSmith (better LangGraph integration, already set up)
2. **Real vs mocked LLM?** → Real LLM with Groq free tier
3. **Test granularity?** → Component isolation + E2E
4. **Scope?** → Full testing suite with CI/CD

---

## Next Steps

After plan approval:
1. Create the directory structure
2. Install `agentevals` dependency
3. Implement fixtures/factories
4. Start with Cartographer component tests as proof of concept
