/**
 * Incident Scenarios Dataset
 *
 * Test scenarios for E2E evaluation of agent workflows.
 * Each scenario represents a real-world incident type with expected outcomes.
 */

import type { IncidentScenario, TrajectoryExpectation } from "../../setup/langsmith.config.js";
import { createAlert, createNullPointerAlert, createDeploymentAlert } from "../../factories/alert.factory.js";

// =============================================================================
// SCENARIO DEFINITIONS
// =============================================================================

/**
 * Code Bug Scenarios - Easy to Hard
 */
export const codeBugScenarios: IncidentScenario[] = [
	{
		id: "code-001",
		name: "Null pointer in auth handler",
		category: "code",
		difficulty: "easy",
		expectedTools: ["github_search_code", "github_get_file_contents", "form_hypothesis", "propose_fix"],
		alert: {
			title: "NullPointerException in AuthHandler",
			description: "Uncaught exception at auth-handler.ts:42 - Cannot read property 'id' of null",
			severity: "high",
		},
		expectedRootCauseCategory: "code",
		minimumConfidence: 70,
	},
	{
		id: "code-002",
		name: "Race condition in checkout",
		category: "code",
		difficulty: "hard",
		expectedTools: ["github_search_code", "render_get_logs", "form_hypothesis"],
		alert: {
			title: "Intermittent checkout failures",
			description: "Random 500 errors during checkout - timing-dependent failures",
			severity: "high",
		},
		expectedRootCauseCategory: "code",
		minimumConfidence: 50, // Lower confidence expected for complex issues
	},
	{
		id: "code-003",
		name: "Type coercion bug",
		category: "code",
		difficulty: "medium",
		expectedTools: ["github_search_code", "github_get_file_contents", "form_hypothesis", "propose_fix"],
		alert: {
			title: "Invalid user ID comparison",
			description: "User matching failing due to string/number comparison",
			severity: "medium",
		},
		expectedRootCauseCategory: "code",
		minimumConfidence: 75,
	},
];

/**
 * Configuration Issue Scenarios
 */
export const configScenarios: IncidentScenario[] = [
	{
		id: "config-001",
		name: "Missing environment variable",
		category: "config",
		difficulty: "easy",
		expectedTools: ["render_get_logs", "render_get_env_vars", "form_hypothesis"],
		alert: {
			title: "Application startup failure",
			description: "Service failed to start - DATABASE_URL is not defined",
			severity: "critical",
		},
		expectedRootCauseCategory: "config",
		minimumConfidence: 90,
	},
	{
		id: "config-002",
		name: "Wrong rate limit threshold",
		category: "config",
		difficulty: "medium",
		expectedTools: ["github_get_commits", "render_get_deployments", "form_hypothesis"],
		alert: {
			title: "Rate limiting too aggressive",
			description: "Legitimate users being rate limited - threshold set to 10 requests/minute",
			severity: "medium",
		},
		expectedRootCauseCategory: "config",
		minimumConfidence: 75,
	},
	{
		id: "config-003",
		name: "Feature flag misconfiguration",
		category: "config",
		difficulty: "medium",
		expectedTools: ["github_search_code", "render_get_logs", "form_hypothesis"],
		alert: {
			title: "New feature visible in production",
			description: "Beta feature enabled for all users instead of test group",
			severity: "high",
		},
		expectedRootCauseCategory: "config",
		minimumConfidence: 80,
	},
];

/**
 * Infrastructure Scenarios
 */
export const infrastructureScenarios: IncidentScenario[] = [
	{
		id: "infra-001",
		name: "Memory exhaustion",
		category: "infrastructure",
		difficulty: "medium",
		expectedTools: ["render_get_service_details", "render_get_logs", "form_hypothesis"],
		alert: {
			title: "Container OOMKilled",
			description: "Service container killed due to memory limit exceeded",
			severity: "critical",
		},
		expectedRootCauseCategory: "infrastructure",
		minimumConfidence: 80,
	},
	{
		id: "infra-002",
		name: "Database connection pool exhausted",
		category: "infrastructure",
		difficulty: "hard",
		expectedTools: ["render_get_logs", "github_search_code", "form_hypothesis"],
		alert: {
			title: "Database connection timeout",
			description: "Connection pool exhausted - all connections in use",
			severity: "high",
		},
		expectedRootCauseCategory: "infrastructure",
		minimumConfidence: 60,
	},
];

/**
 * External Dependency Scenarios
 */
export const externalScenarios: IncidentScenario[] = [
	{
		id: "external-001",
		name: "Third-party API outage",
		category: "external",
		difficulty: "medium",
		expectedTools: ["render_get_logs", "form_hypothesis"],
		alert: {
			title: "Payment processing failures",
			description: "Stripe API returning 503 errors",
			severity: "critical",
		},
		expectedRootCauseCategory: "external",
		minimumConfidence: 85,
	},
	{
		id: "external-002",
		name: "DNS resolution failure",
		category: "external",
		difficulty: "medium",
		expectedTools: ["render_get_logs", "form_hypothesis"],
		alert: {
			title: "External service unreachable",
			description: "DNS lookup failed for api.example.com",
			severity: "high",
		},
		expectedRootCauseCategory: "external",
		minimumConfidence: 80,
	},
];

/**
 * Deployment-Related Scenarios
 */
export const deploymentScenarios: IncidentScenario[] = [
	{
		id: "deploy-001",
		name: "Bad deployment causing errors",
		category: "code",
		difficulty: "medium",
		expectedTools: ["render_get_deployments", "github_get_commits", "suggest_rollback"],
		alert: {
			title: "Error rate spike after deployment",
			description: "500 errors increased from 0.1% to 15% after deploy",
			severity: "critical",
		},
		expectedRootCauseCategory: "code",
		minimumConfidence: 80,
	},
	{
		id: "deploy-002",
		name: "Build failure on deploy",
		category: "code",
		difficulty: "easy",
		expectedTools: ["render_get_deployments", "github_get_commits", "form_hypothesis"],
		alert: {
			title: "Deployment failed",
			description: "Build exited with code 1 - TypeScript compilation error",
			severity: "high",
		},
		expectedRootCauseCategory: "code",
		minimumConfidence: 90,
	},
];

/**
 * Unknown/Complex Scenarios
 */
export const unknownScenarios: IncidentScenario[] = [
	{
		id: "unknown-001",
		name: "Intermittent failures no pattern",
		category: "unknown",
		difficulty: "hard",
		expectedTools: ["render_get_logs", "github_search_code", "form_hypothesis"],
		alert: {
			title: "Random service failures",
			description: "Intermittent 500 errors with no clear pattern",
			severity: "medium",
		},
		expectedRootCauseCategory: "unknown",
		minimumConfidence: 40, // Low confidence expected
	},
];

// =============================================================================
// ALL SCENARIOS
// =============================================================================

export const allScenarios: IncidentScenario[] = [
	...codeBugScenarios,
	...configScenarios,
	...infrastructureScenarios,
	...externalScenarios,
	...deploymentScenarios,
	...unknownScenarios,
];

// =============================================================================
// TRAJECTORY EXPECTATIONS
// =============================================================================

/**
 * Get trajectory expectations for a scenario
 */
export function getTrajectoryExpectation(scenario: IncidentScenario): TrajectoryExpectation {
	return {
		requiredTools: scenario.expectedTools,
		forbiddenTools: [
			// Write operations should never be called
			"github_create_pr",
			"github_push_changes",
			"render_trigger_deploy",
		],
		maxToolCalls: scenario.difficulty === "easy" ? 10 : scenario.difficulty === "medium" ? 15 : 25,
	};
}

// =============================================================================
// SCENARIO HELPERS
// =============================================================================

/**
 * Get scenarios by category
 */
export function getScenariosByCategory(
	category: IncidentScenario["category"],
): IncidentScenario[] {
	return allScenarios.filter((s) => s.category === category);
}

/**
 * Get scenarios by difficulty
 */
export function getScenariosByDifficulty(
	difficulty: IncidentScenario["difficulty"],
): IncidentScenario[] {
	return allScenarios.filter((s) => s.difficulty === difficulty);
}

/**
 * Convert scenario to test input
 */
export function scenarioToTestInput(scenario: IncidentScenario): {
	investigationId: string;
	incidentId: string;
	alerts: Array<ReturnType<typeof createAlert>>;
	priority: "low" | "normal" | "high" | "critical";
} {
	const severityToPriority: Record<string, "low" | "normal" | "high" | "critical"> = {
		critical: "critical",
		high: "high",
		medium: "normal",
		low: "low",
		info: "low",
	};

	return {
		investigationId: `inv-${scenario.id}`,
		incidentId: `inc-${scenario.id}`,
		alerts: [
			createAlert({
				alertId: `alert-${scenario.id}`,
				title: scenario.alert.title,
				description: scenario.alert.description,
				severity: scenario.alert.severity,
			}),
		],
		priority: severityToPriority[scenario.alert.severity] ?? "normal",
	};
}
