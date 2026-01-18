/**
 * LangSmith Setup for E2E Tests
 *
 * This file initializes LangSmith tracking for E2E evaluation tests.
 * Only loaded when running E2E tests via vitest.e2e.config.ts.
 */

import { beforeAll, afterAll } from "vitest";
import { LANGSMITH_CONFIG, initLangSmith, shutdownLangSmith } from "./langsmith.config.js";

// =============================================================================
// LANGSMITH INITIALIZATION
// =============================================================================

beforeAll(async () => {
	// Check for required environment variable
	if (!process.env.LANGSMITH_API_KEY) {
		console.warn(
			"⚠️  LANGSMITH_API_KEY not set. E2E tests will run without LangSmith tracking.",
		);
		return;
	}

	// Enable LangSmith tracing
	process.env.LANGSMITH_TRACING = "true";
	process.env.LANGCHAIN_TRACING_V2 = "true";
	process.env.LANGCHAIN_PROJECT = LANGSMITH_CONFIG.projectName;

	try {
		await initLangSmith();
		console.log(`✅ LangSmith initialized for project: ${LANGSMITH_CONFIG.projectName}`);
	} catch (error) {
		console.warn("⚠️  Failed to initialize LangSmith:", error);
	}
});

afterAll(async () => {
	if (process.env.LANGSMITH_API_KEY) {
		await shutdownLangSmith();
		console.log("✅ LangSmith shutdown complete");
	}
});
