/**
 * Vitest Setup for Agent Evaluations
 *
 * Configures the test environment:
 * - Loads environment variables from .env
 * - Sets up test database (optional)
 * - Seeds integrations (if test DB available)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { beforeAll, afterAll } from "vitest";

// =============================================================================
// ENVIRONMENT SETUP
// =============================================================================

// Load .env file from agents package root
config({ path: resolve(__dirname, "../../.env") });

// Also try .env.test for test-specific overrides
config({ path: resolve(__dirname, "../../.env.test"), override: true });

// Ensure LangSmith tracing is enabled
process.env.LANGSMITH_TRACING = "true";
process.env.LANGCHAIN_TRACING_V2 = "true";

// =============================================================================
// TEST DATABASE SETUP (OPTIONAL)
// =============================================================================

/**
 * Test database setup is optional.
 * If DATABASE_URL is not set, tests will run without integrations.
 * This allows running basic evals without full infrastructure.
 */

let prismaClient: unknown = null;

beforeAll(async () => {
	console.log("\n[Setup] Initializing eval environment...");
	const provider = process.env.PRISMALENS_LLM_PROVIDER || "ollama";
	const model = process.env.PRISMALENS_LLM_MODEL || "(provider default)";
	console.log(`[Setup] LLM: provider=${provider}, model=${model}`);
	if (provider === "ollama") {
		console.log(`[Setup] Ollama URL: ${process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434"}`);
	}
	console.log(`[Setup] LangSmith Project: ${process.env.LANGCHAIN_PROJECT || process.env.LANGSMITH_PROJECT || "not set"}`);

	// Check for test database
	const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
	if (dbUrl && dbUrl.includes("test.db")) {
		console.log("[Setup] Test database detected, seeding integrations...");

		try {
			// Dynamic import to avoid dependency issues when DB not available
			const { PrismaClient } = await import("@prisma/client");
			const { seedTestIntegrations } = await import("./seed-integrations.js");

			prismaClient = new PrismaClient({
				datasources: { db: { url: dbUrl } },
			});

			await (prismaClient as any).$connect();
			await seedTestIntegrations(prismaClient as any);
		} catch (error) {
			console.warn("[Setup] Failed to set up test database:", error);
			console.warn("[Setup] Running without integrations");
		}
	} else {
		console.log("[Setup] No test database configured, running without integrations");
	}

	console.log("[Setup] Eval environment ready\n");
});

afterAll(async () => {
	if (prismaClient) {
		try {
			await (prismaClient as any).$disconnect();
			console.log("\n[Teardown] Test database disconnected");
		} catch {
			// Ignore disconnect errors
		}
	}
});

// =============================================================================
// GLOBAL TEST CONFIGURATION
// =============================================================================

// Increase timeout for LLM calls
// This is also set in vitest.eval.config.ts but we set it here as a safety net
if (typeof globalThis !== "undefined") {
	(globalThis as any).__EVAL_TIMEOUT__ = 300000; // 5 minutes
}
