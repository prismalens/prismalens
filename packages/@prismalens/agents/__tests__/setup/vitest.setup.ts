/**
 * Vitest Global Setup
 *
 * This file runs before all tests and handles:
 * - Environment variable configuration
 * - Tool store reset between tests
 * - Mock configuration
 * - Test utilities registration
 */

import { afterEach, beforeAll, beforeEach, vi } from "vitest";

// =============================================================================
// ENVIRONMENT SETUP
// =============================================================================

beforeAll(() => {
	// Set test environment variables
	process.env.NODE_ENV = "test";

	// Disable actual LLM calls by default (use mocks)
	process.env.DISABLE_REAL_LLM = "true";

	// Set default LLM provider for tests
	process.env.LLM_PROVIDER = "openai";

	// Set test API keys (these won't be used when mocking)
	process.env.OPENAI_API_KEY = "test-openai-key";
	process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
	process.env.GOOGLE_API_KEY = "test-google-key";

	// Disable LangSmith tracing for unit/integration tests
	// (E2E tests enable this separately)
	process.env.LANGSMITH_TRACING = "false";
	process.env.LANGCHAIN_TRACING_V2 = "false";
});

// =============================================================================
// STORE RESET BETWEEN TESTS
// =============================================================================

/**
 * Reset all tool stores before each test to ensure isolation.
 * This is critical for the hypothesis and recommendation stores.
 */
beforeEach(async () => {
	// Dynamically import to avoid module resolution issues during setup
	try {
		const hypothesisModule = await import("../../src/tools/hypothesis.js");
		hypothesisModule.resetHypothesisStore();
	} catch {
		// Module not yet built, skip reset
	}

	try {
		const fixProposalModule = await import("../../src/tools/fix-proposal.js");
		fixProposalModule.resetRecommendationStore();
	} catch {
		// Module not yet built, skip reset
	}
});

// =============================================================================
// MOCK CLEANUP
// =============================================================================

afterEach(() => {
	// Clear all mocks after each test
	vi.clearAllMocks();

	// Reset mock timers if any were used
	vi.useRealTimers();
});

// =============================================================================
// GLOBAL TEST UTILITIES
// =============================================================================

/**
 * Helper to wait for a condition with timeout
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Helper to create a temporary test directory
 */
export async function createTempTestDir(): Promise<string> {
	const fs = await import("fs/promises");
	const os = await import("os");
	const path = await import("path");

	const tempDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "prismalens-test-"),
	);
	return tempDir;
}

/**
 * Helper to clean up a temporary test directory
 */
export async function cleanupTempTestDir(dir: string): Promise<void> {
	const fs = await import("fs/promises");
	await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Helper to create a deterministic UUID for testing
 */
export function createTestId(prefix: string, index: number): string {
	return `${prefix}-test-${index.toString().padStart(4, "0")}`;
}

// =============================================================================
// TYPE DECLARATIONS FOR GLOBAL TEST UTILITIES
// =============================================================================

declare global {
	// eslint-disable-next-line no-var
	var waitFor: typeof waitFor;
	// eslint-disable-next-line no-var
	var createTempTestDir: typeof createTempTestDir;
	// eslint-disable-next-line no-var
	var cleanupTempTestDir: typeof cleanupTempTestDir;
	// eslint-disable-next-line no-var
	var createTestId: typeof createTestId;
}

// Make utilities available globally
globalThis.waitFor = waitFor;
globalThis.createTempTestDir = createTempTestDir;
globalThis.cleanupTempTestDir = cleanupTempTestDir;
globalThis.createTestId = createTestId;
