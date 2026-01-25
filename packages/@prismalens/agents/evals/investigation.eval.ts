/**
 * Investigation E2E Evaluations
 *
 * Uses langsmith/vitest to test full graph execution.
 *
 * Run with: pnpm eval
 *
 * Prerequisites:
 *   1. Set LANGSMITH_API_KEY in .env
 *   2. Set an LLM API key: GROQ_API_KEY (free), ANTHROPIC_API_KEY, or OPENAI_API_KEY
 */
import * as ls from "langsmith/vitest";
import { expect } from "vitest";

// =============================================================================
// GRAPH IMPORT (Lazy)
// =============================================================================

type Graph = Awaited<typeof import("../src/graph/studio.js")>["graph"];
let graph: Graph | null = null;

async function getGraph(): Promise<Graph> {
	if (!graph) {
		const mod = await import("../src/graph/studio.js");
		graph = mod.graph;
	}
	return graph;
}

// =============================================================================
// TEST SCENARIOS
// =============================================================================

/**
 * Scenario definition for testing
 */
interface TestScenario {
	name: string;
	difficulty: "easy" | "medium" | "hard";
	input: {
		investigationId: string;
		incidentId: string;
		priority: "low" | "normal" | "high" | "critical";
		incident: {
			incidentId: string;
			number: number;
			title: string;
			description?: string;
			severity: "critical" | "high" | "medium" | "low" | "info";
			status: "triggered" | "investigating" | "identified" | "monitoring" | "resolved" | "closed";
			priority: "p1" | "p2" | "p3" | "p4" | "p5";
			serviceName?: string;
			alertCount: number;
			triggeredAt: string;
		};
		alerts: Array<{
			alertId: string;
			title: string;
			description?: string;
			severity: "critical" | "high" | "medium" | "low" | "info";
			source?: string;
			serviceName?: string;
		}>;
		integrations: unknown[];
	};
	expected: {
		status: "completed" | "failed";
		minConfidence: number;
		category?: "code" | "config" | "infrastructure" | "external" | "unknown";
	};
}

const scenarios: TestScenario[] = [
	// Easy scenario - Clear code bug
	{
		name: "NullPointerException in UserService",
		difficulty: "easy",
		input: {
			investigationId: "eval-npe-001",
			incidentId: "inc-npe-001",
			priority: "high",
			incident: {
				incidentId: "inc-npe-001",
				number: 1001,
				title: "High CPU and 500 errors in api-server",
				description:
					"NullPointerException in UserService.getUser() causing 500 errors. Stack trace shows null user ID being passed from AuthMiddleware.",
				severity: "high",
				status: "triggered",
				priority: "p2",
				serviceName: "api-server",
				alertCount: 3,
				triggeredAt: new Date().toISOString(),
			},
			alerts: [
				{
					alertId: "alert-cpu-001",
					title: "CPU > 90% for 5 minutes",
					description: "API server CPU utilization critically high",
					severity: "high",
					source: "prometheus",
					serviceName: "api-server",
				},
				{
					alertId: "alert-err-001",
					title: "Error rate spike: 500 errors",
					description: "NullPointerException in UserService.getUser()",
					severity: "high",
					source: "sentry",
					serviceName: "api-server",
				},
				{
					alertId: "alert-latency-001",
					title: "P99 latency > 2s",
					description: "API response times degraded",
					severity: "medium",
					source: "prometheus",
					serviceName: "api-server",
				},
			],
			integrations: [],
		},
		expected: {
			status: "completed",
			minConfidence: 50,
			category: "code",
		},
	},

	// Medium scenario - Configuration issue
	{
		name: "Database connection timeout after config change",
		difficulty: "medium",
		input: {
			investigationId: "eval-db-001",
			incidentId: "inc-db-001",
			priority: "critical",
			incident: {
				incidentId: "inc-db-001",
				number: 1002,
				title: "Database connection failures",
				description:
					"Multiple services failing to connect to PostgreSQL after recent config deployment. Connection pool exhaustion suspected.",
				severity: "critical",
				status: "triggered",
				priority: "p1",
				serviceName: "postgres-primary",
				alertCount: 5,
				triggeredAt: new Date().toISOString(),
			},
			alerts: [
				{
					alertId: "alert-db-001",
					title: "PostgreSQL connection errors",
					description: "Connection refused errors from multiple services",
					severity: "critical",
					source: "prometheus",
					serviceName: "postgres-primary",
				},
				{
					alertId: "alert-pool-001",
					title: "Connection pool exhausted",
					description: "api-server connection pool at 100% utilization",
					severity: "high",
					source: "prometheus",
					serviceName: "api-server",
				},
			],
			integrations: [],
		},
		expected: {
			status: "completed",
			minConfidence: 40,
			category: "config",
		},
	},
];

// =============================================================================
// EVALUATIONS
// =============================================================================

ls.describe("Investigation E2E", () => {
	for (const scenario of scenarios) {
		ls.test(
			scenario.name,
			{
				inputs: scenario.input,
				referenceOutputs: scenario.expected,
			},
			async ({ inputs, referenceOutputs }) => {
				const g = await getGraph();

				console.log(`\n[Eval] Running: ${scenario.name}`);
				const startTime = Date.now();

				const result = await g.invoke(inputs);

				const duration = Date.now() - startTime;
				console.log(`[Eval] Completed in ${duration}ms`);

				// Log outputs for LangSmith tracking
				ls.logOutputs({
					status: result.status,
					confidence: result.confidence,
					rootCauseCategory: result.rootCauseCategory,
					rootCause: result.rootCause,
					hypothesesCount: result.hypotheses?.length || 0,
					recommendationsCount: result.recommendations?.length || 0,
					summary: result.summary,
					durationMs: duration,
				});

				// Assertions
				expect(result.status).toBe(referenceOutputs.status);
				expect(result.confidence).toBeGreaterThanOrEqual(
					referenceOutputs.minConfidence,
				);

				// Category check if specified
				if (referenceOutputs.category) {
					expect(result.rootCauseCategory).toBe(referenceOutputs.category);
				}

				console.log(`[Eval] Result: ${result.status}, confidence: ${result.confidence}%`);
				console.log(`[Eval] Category: ${result.rootCauseCategory}`);
			},
		);
	}
});

// =============================================================================
// SINGLE SCENARIO TEST (for debugging)
// =============================================================================

ls.describe("Investigation Debug", () => {
	ls.test(
		"Single scenario for debugging",
		{
			inputs: scenarios[0].input,
			referenceOutputs: scenarios[0].expected,
		},
		async ({ inputs, referenceOutputs }) => {
			const g = await getGraph();

			console.log("\n[Debug] Running single scenario...");
			const result = await g.invoke(inputs);

			ls.logOutputs({
				status: result.status,
				confidence: result.confidence,
				rootCauseCategory: result.rootCauseCategory,
				summary: result.summary,
			});

			console.log("\n[Debug] Full result:");
			console.log(JSON.stringify({
				status: result.status,
				confidence: result.confidence,
				rootCauseCategory: result.rootCauseCategory,
				hypotheses: result.hypotheses,
				recommendations: result.recommendations,
				summary: result.summary,
			}, null, 2));

			expect(result.status).toBe(referenceOutputs.status);
		},
	);
});
