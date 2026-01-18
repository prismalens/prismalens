# Test Suite

Comprehensive test suite for the `@prismalens/agents` package.

## Directory Structure

```
__tests__/
├── unit/                    # Fast, isolated unit tests
│   ├── tools/               # Tool function tests
│   ├── llm/                 # LLM factory tests
│   └── bundles/             # Tool bundle system tests
├── integration/             # Integration tests with mocked externals
│   ├── commander/           # Commander orchestration tests
│   └── subagents/           # SubAgent behavior tests
├── e2e/                     # End-to-end workflow tests
│   ├── workflows/           # Full investigation workflows
│   └── scenarios/           # Scenario-based test cases
├── langsmith/               # LangSmith evaluation tests
│   ├── datasets/            # Test scenario definitions
│   └── evaluators/          # Custom evaluation functions
├── factories/               # Test data factories
├── mocks/                   # Mock implementations
├── fixtures/                # Static test data
│   ├── alerts/              # Sample alert payloads
│   └── cassettes/           # Recorded API responses
├── evaluators/              # Custom evaluator functions
└── setup/                   # Test configuration
    ├── vitest.setup.ts      # Global test setup
    ├── langsmith.setup.ts   # LangSmith initialization
    └── langsmith.config.ts  # LangSmith configuration
```

## Running Tests

```bash
# All unit and integration tests
pnpm test

# Watch mode during development
pnpm test:watch

# Unit tests only
pnpm test:unit

# Integration tests only
pnpm test:integration

# E2E tests (longer timeout, sequential)
pnpm test:e2e

# With coverage report
pnpm test:coverage
```

## Test Categories

### Unit Tests (`__tests__/unit/`)

Fast, isolated tests for individual functions and modules:

- **tools/**: Test tool functions (hypothesis, fix-proposal)
- **llm/**: Test LLM factory for different providers
- **bundles/**: Test tool bundle system (manifest, registry, sources)

Unit tests run with:
- Mocked LLM calls (`DISABLE_REAL_LLM=true`)
- Isolated tool stores (reset between tests)
- 30s timeout per test

### Integration Tests (`__tests__/integration/`)

Test component interactions with mocked external services:

- **commander/**: Test Commander orchestration and handoffs
- **subagents/**: Test SubAgent behavior (Cartographer, Detective, Surgeon)

Integration tests validate:
- Tool usage patterns
- SubAgent delegation
- State management
- Error handling

### E2E Tests (`__tests__/e2e/`)

Full workflow tests using real or mocked LLM calls:

- **workflows/**: Complete investigation workflows
- **scenarios/**: Scenario-based tests (code bugs, config issues, etc.)

E2E tests run with:
- 2-minute timeout per test
- Sequential execution (single fork)
- Optional LangSmith tracing
- Real LLM calls (when configured)

## Test Utilities

### Factories (`__tests__/factories/`)

Generate test data with realistic defaults:

```typescript
import { createTestAlert, createTestIncident, createTestHypothesis } from '../factories';

// Create a test alert
const alert = createTestAlert({
  severity: 'high',
  title: 'Custom alert title',
});

// Create a test incident with multiple alerts
const incident = createTestIncident({
  alertCount: 5,
  severity: 'critical',
});

// Create a hypothesis
const hypothesis = createTestHypothesis({
  category: 'code',
  confidence: 85,
});
```

Available factories:
- `createTestAlert()` - Generate alert payloads
- `createTestIncident()` - Generate incident contexts
- `createTestHypothesis()` - Generate hypothesis objects
- `createTestRecommendation()` - Generate fix proposals
- `createTestIntegration()` - Generate integration configs
- `createTestState()` - Generate investigation states

### Mocks (`__tests__/mocks/`)

Pre-configured mock implementations:

```typescript
import { mockLLM, mockGitHubAPI, mockRenderAPI } from '../mocks';

// Mock LLM responses
mockLLM.mockToolCall('form_hypothesis', {
  category: 'code',
  description: 'Null pointer in handler',
  confidence: 80,
});

// Mock GitHub API
mockGitHubAPI.mockSearchCode('error', [
  { path: 'src/handler.ts', content: '...' }
]);

// Mock Render API
mockRenderAPI.mockGetLogs('srv-123', [
  { timestamp: '...', message: 'Error: ...' }
]);
```

### Fixtures (`__tests__/fixtures/`)

Static test data for reproducible tests:

- **alerts/**: Sample alert JSON files
- **cassettes/**: Recorded API responses for replay testing

### Evaluators (`__tests__/evaluators/`)

Custom evaluation functions for agent outputs:

```typescript
import {
  evaluateTrajectory,
  evaluateHypothesis,
  evaluateRecommendation,
} from '../evaluators';

// Evaluate if agent used correct tools
const trajectoryScore = evaluateTrajectory(toolCalls, expectedTools);

// Evaluate hypothesis quality
const hypothesisScore = evaluateHypothesis(hypothesis, {
  expectedCategory: 'code',
  minimumConfidence: 70,
});

// Evaluate recommendation quality
const recommendationScore = evaluateRecommendation(recommendation, {
  hasCodeChange: true,
  hasVerificationSteps: true,
});
```

## Global Test Utilities

Available in all tests via `vitest.setup.ts`:

```typescript
// Wait for a condition with timeout
await waitFor(() => someCondition(), 5000);

// Create a temporary test directory
const tempDir = await createTempTestDir();

// Clean up temporary directory
await cleanupTempTestDir(tempDir);

// Create deterministic test IDs
const id = createTestId('inv', 1); // 'inv-test-0001'
```

## LangSmith Evaluation

For evaluating agent quality against curated datasets.

### Setup

1. Set your LangSmith API key:
```bash
export LANGSMITH_API_KEY=your-api-key
```

2. Seed the evaluation dataset:
```bash
pnpm eval:seed
```

3. Run evaluations:
```bash
pnpm eval:run
```

### One Command

Run full evaluation pipeline:
```bash
pnpm eval:langsmith
```

### Dataset Seeding Options

```bash
# Seed all scenarios
pnpm eval:seed

# Preview without changes
npx tsx __tests__/langsmith/seed-datasets.ts --dry-run

# Seed only code bug scenarios
npx tsx __tests__/langsmith/seed-datasets.ts --category=code

# Seed only easy scenarios
npx tsx __tests__/langsmith/seed-datasets.ts --difficulty=easy

# Clear existing and re-seed
npx tsx __tests__/langsmith/seed-datasets.ts --clear

# View dataset statistics
npx tsx __tests__/langsmith/seed-datasets.ts --stats
```

### Scenario Categories

Test scenarios are organized by root cause category:

| Category | Description |
|----------|-------------|
| `code` | Code bugs (null pointers, logic errors) |
| `config` | Configuration issues (env vars, thresholds) |
| `infrastructure` | Infrastructure problems (resources, network) |
| `external` | External service failures |
| `deployment` | Deployment-related issues |
| `unknown` | Edge cases, unclear root cause |

### Difficulty Levels

| Difficulty | Description |
|------------|-------------|
| `easy` | Clear error message, single service |
| `medium` | Some investigation needed, correlation |
| `hard` | Multiple services, complex causation |

## Configuration

### vitest.config.ts (Unit/Integration)

```typescript
{
  include: ["__tests__/unit/**/*.test.ts", "__tests__/integration/**/*.test.ts"],
  exclude: ["__tests__/e2e/**/*", "__tests__/langsmith/**/*"],
  testTimeout: 30000,      // 30s per test
  hookTimeout: 10000,      // 10s for setup/teardown
  pool: "threads",         // Parallel execution
  retry: 1,                // Retry failed tests once
}
```

### vitest.e2e.config.ts (E2E)

```typescript
{
  include: ["__tests__/e2e/**/*.test.ts", "__tests__/langsmith/**/*.test.ts"],
  testTimeout: 120000,     // 2 min per test
  hookTimeout: 30000,      // 30s for setup/teardown
  pool: "forks",           // Sequential execution
  retry: 0,                // No retry (investigate flakiness)
  env: {
    LANGSMITH_TRACING: "true",
    LANGCHAIN_TRACING_V2: "true",
  },
}
```

## Writing Tests

### Unit Test Pattern

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestAlert } from '../../factories';
import { myFunction } from '../../../src/module';

describe('myFunction', () => {
  beforeEach(() => {
    // Reset state before each test
    vi.clearAllMocks();
  });

  it('should handle valid input', () => {
    const alert = createTestAlert({ severity: 'high' });
    const result = myFunction(alert);
    expect(result).toBeDefined();
  });

  it('should throw on invalid input', () => {
    expect(() => myFunction(null)).toThrow('Invalid input');
  });
});
```

### Integration Test Pattern

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestIntegration, createTestIncident } from '../../factories';
import { mockGitHubAPI } from '../../mocks';
import { createCartographerSubAgent } from '../../../src/agents/subagents';

describe('Cartographer SubAgent', () => {
  beforeEach(() => {
    mockGitHubAPI.reset();
  });

  it('should gather code context', async () => {
    // Setup mock
    mockGitHubAPI.mockSearchCode('error', [
      { path: 'src/handler.ts', content: 'throw new Error(...)' }
    ]);

    // Create agent
    const agent = createCartographerSubAgent({
      integrations: [createTestIntegration({ type: 'github' })],
    });

    // Run agent
    const result = await agent.invoke({
      task: 'Search for error origins',
    });

    // Assert
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file: 'src/handler.ts' })
    );
  });
});
```

### E2E Test Pattern

```typescript
import { describe, it, expect } from 'vitest';
import { createTestIncident, createTestIntegration } from '../../factories';
import { runInvestigation } from '../../../src/graph';

describe('Full Investigation Workflow', () => {
  it('should complete investigation for code bug', async () => {
    const result = await runInvestigation({
      investigationId: createTestId('inv', 1),
      incidentId: createTestId('inc', 1),
      alerts: [createTestAlert({ title: 'NullPointerException in UserHandler' })],
      integrations: [
        createTestIntegration({ type: 'github' }),
        createTestIntegration({ type: 'render' }),
      ],
    });

    // Verify investigation completed
    expect(result.status).toBe('completed');

    // Verify hypothesis was formed
    expect(result.hypotheses).toHaveLength(expect.any(Number));
    expect(result.hypotheses[0].confidence).toBeGreaterThanOrEqual(70);

    // Verify recommendations were generated
    expect(result.recommendations).toBeDefined();
  }, 120000); // 2 min timeout
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISABLE_REAL_LLM` | Disable real LLM calls (use mocks) | `true` |
| `LLM_PROVIDER` | LLM provider for tests | `openai` |
| `LANGSMITH_API_KEY` | LangSmith API key | - |
| `LANGSMITH_TRACING` | Enable LangSmith tracing | `false` |

## Debugging Tips

### Run a single test file

```bash
pnpm test __tests__/unit/tools/hypothesis.test.ts
```

### Run tests matching a pattern

```bash
pnpm test -t "should form hypothesis"
```

### Enable verbose logging

```bash
DEBUG=prismalens:* pnpm test
```

### Check test coverage gaps

```bash
pnpm test:coverage
# Open coverage/index.html in browser
```

### Debug with real LLM calls

```bash
DISABLE_REAL_LLM=false LLM_PROVIDER=anthropic pnpm test:e2e
```
