/**
 * Database Issues Scenario
 *
 * E2E test scenario for investigating database-related incidents.
 * Tests scenarios like connection pool exhaustion, deadlocks, migration failures.
 */

import { faker } from "@faker-js/faker";
import type { AlertContext, IncidentContext, IntegrationContext } from "../../../src/types/state.js";
import { createAlert, createTimeoutAlert } from "../../factories/alert.factory.js";
import { createIncident, type IncidentOptions } from "../../factories/incident.factory.js";
import { createRenderIntegration, createGitHubIntegration } from "../../factories/integration.factory.js";

// =============================================================================
// DATABASE-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create a database connection pool exhaustion incident
 */
export function createConnectionPoolIncident(
	options: IncidentOptions = {},
): { incident: IncidentContext; alerts: AlertContext[] } {
	const serviceName = options.serviceName ?? "api-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alerts = [
		createAlert({
			title: "Database connection pool exhausted",
			description: "All 20 database connections in use, queries queuing",
			severity: "critical",
			serviceName,
			serviceId,
			labels: {
				error_type: "database",
				pool_size: "20",
				waiting_queries: "150",
			},
		}),
		createTimeoutAlert({
			title: "Database query timeout",
			description: "Queries timing out after waiting for connection",
			serviceName,
			serviceId,
		}),
	];

	const incident = createIncident({
		title: options.title ?? "Database connection pool exhaustion",
		description: options.description ?? "Connection pool fully utilized causing query timeouts",
		severity: options.severity ?? "critical",
		priority: options.priority ?? "p1",
		serviceName,
		serviceId,
		alertCount: alerts.length,
		correlationReason: "Alerts correlated by database connection metrics",
		tags: ["database", "connection-pool", "performance"],
		customerImpact: "Slow response times and request failures",
		...options,
	});

	return { incident, alerts };
}

/**
 * Create a database deadlock incident
 */
export function createDeadlockIncident(
	options: IncidentOptions = {},
): { incident: IncidentContext; alerts: AlertContext[] } {
	const serviceName = options.serviceName ?? "order-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alert = createAlert({
		title: "Database deadlock detected",
		description: "Deadlock between transactions updating orders and inventory tables",
		severity: "high",
		serviceName,
		serviceId,
		labels: {
			error_type: "database_deadlock",
			tables: "orders,inventory",
			frequency: "5/min",
		},
	});

	const incident = createIncident({
		title: options.title ?? "Database deadlock in order processing",
		description: options.description ?? "Recurring deadlocks between order and inventory updates",
		severity: options.severity ?? "high",
		priority: options.priority ?? "p2",
		serviceName,
		serviceId,
		alertCount: 1,
		correlationReason: "Single deadlock alert",
		tags: ["database", "deadlock", "transactions"],
		customerImpact: "Order processing failures for some customers",
		...options,
	});

	return { incident, alerts: [alert] };
}

/**
 * Create a database migration failure incident
 */
export function createMigrationFailureIncident(
	options: IncidentOptions = {},
): { incident: IncidentContext; alerts: AlertContext[] } {
	const serviceName = options.serviceName ?? "api-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alerts = [
		createAlert({
			title: "Database migration failed",
			description: "Migration 20240101_add_user_preferences failed with unique constraint violation",
			severity: "critical",
			serviceName,
			serviceId,
			labels: {
				error_type: "migration_failure",
				migration_name: "20240101_add_user_preferences",
				error: "unique_violation",
			},
		}),
		createAlert({
			title: "Application startup failed",
			description: "Application cannot start due to pending database migration",
			severity: "critical",
			serviceName,
			serviceId,
		}),
	];

	const incident = createIncident({
		title: options.title ?? "Database migration failure blocking deployment",
		description: options.description ?? "Failed migration preventing service from starting",
		severity: options.severity ?? "critical",
		priority: options.priority ?? "p1",
		serviceName,
		serviceId,
		alertCount: alerts.length,
		correlationReason: "Migration failure and startup failure correlated",
		tags: ["database", "migration", "deployment"],
		customerImpact: "Service completely down",
		...options,
	});

	return { incident, alerts };
}

// =============================================================================
// SCENARIO DEFINITIONS
// =============================================================================

export interface DatabaseScenarioConfig {
	incident?: Partial<IncidentContext>;
	expectations?: {
		minimumConfidence?: number;
		expectedKeywords?: string[];
	};
}

/**
 * Standard database scenario: Connection pool exhaustion
 */
export function createDatabaseScenario(config: DatabaseScenarioConfig = {}): {
	investigationId: string;
	incidentId: string;
	priority: "critical";
	incident: IncidentContext;
	alerts: AlertContext[];
	integrations: IntegrationContext[];
	expectations: {
		minimumConfidence: number;
		expectedCategory: "infrastructure";
		expectedTools: string[];
		expectedKeywords: string[];
	};
} {
	const { incident, alerts } = createConnectionPoolIncident({
		...config.incident,
	});

	const integrations = [
		createRenderIntegration(),
		createGitHubIntegration(),
	];

	return {
		investigationId: `inv-db-pool-${Date.now()}`,
		incidentId: incident.incidentId,
		priority: "critical",
		incident,
		alerts,
		integrations,
		expectations: {
			minimumConfidence: config.expectations?.minimumConfidence ?? 70,
			expectedCategory: "infrastructure",
			expectedTools: [
				"render_get_logs",
				"github_search_code",
				"form_hypothesis",
			],
			expectedKeywords: config.expectations?.expectedKeywords ?? [
				"connection",
				"pool",
				"database",
				"timeout",
			],
		},
	};
}

/**
 * Deadlock scenario
 */
export function createDeadlockScenario(config: DatabaseScenarioConfig = {}): {
	investigationId: string;
	incidentId: string;
	priority: "high";
	incident: IncidentContext;
	alerts: AlertContext[];
	integrations: IntegrationContext[];
	expectations: {
		minimumConfidence: number;
		expectedCategory: "code";
		expectedTools: string[];
		expectedKeywords: string[];
	};
} {
	const { incident, alerts } = createDeadlockIncident({
		...config.incident,
	});

	const integrations = [
		createRenderIntegration(),
		createGitHubIntegration(),
	];

	return {
		investigationId: `inv-deadlock-${Date.now()}`,
		incidentId: incident.incidentId,
		priority: "high",
		incident,
		alerts,
		integrations,
		expectations: {
			minimumConfidence: config.expectations?.minimumConfidence ?? 75,
			expectedCategory: "code",
			expectedTools: [
				"render_get_logs",
				"github_search_code",
				"form_hypothesis",
				"propose_fix",
			],
			expectedKeywords: config.expectations?.expectedKeywords ?? [
				"deadlock",
				"transaction",
				"order",
				"inventory",
			],
		},
	};
}

// =============================================================================
// MOCK RESPONSES
// =============================================================================

export const expectedPoolExhaustionLogs = [
	{
		id: "log-1",
		timestamp: new Date(Date.now() - 120000).toISOString(),
		message: "[database] Connection pool: 18/20 connections in use",
		level: "info",
	},
	{
		id: "log-2",
		timestamp: new Date(Date.now() - 60000).toISOString(),
		message: "[database] Connection pool: 20/20 connections in use, queue depth: 50",
		level: "warning",
	},
	{
		id: "log-3",
		timestamp: new Date(Date.now() - 30000).toISOString(),
		message: "[database] Connection acquisition timeout after 30s",
		level: "error",
	},
	{
		id: "log-4",
		timestamp: new Date(Date.now() - 25000).toISOString(),
		message: "[api] Request failed: Unable to acquire database connection",
		level: "error",
	},
];

export const expectedPoolHypothesis = {
	claim: "Database connection pool exhausted due to connection leak or insufficient pool size",
	confidence: 75,
	category: "infrastructure",
	evidence: [
		"Logs show pool reaching 100% utilization",
		"Query queue depth increasing over time",
		"No recent deployment or traffic spike",
		"Connection count not decreasing after requests complete",
	],
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export function validateDatabaseResult(result: {
	rootCauseCategory: string | null;
	confidence: number | null;
	hypotheses: Array<{ claim: string; confidence: number; category?: string }>;
	recommendations: Array<{ category: string; title: string }>;
}): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// Database issues can be infrastructure or code
	if (
		result.rootCauseCategory !== "infrastructure" &&
		result.rootCauseCategory !== "code"
	) {
		errors.push(
			`Expected category 'infrastructure' or 'code', got '${result.rootCauseCategory}'`,
		);
	}

	if (!result.confidence || result.confidence < 65) {
		errors.push(`Expected confidence >= 65, got ${result.confidence}`);
	}

	if (result.hypotheses.length === 0) {
		errors.push("No hypotheses formed");
	}

	if (result.recommendations.length === 0) {
		errors.push("No recommendations proposed");
	}

	// Should have actionable recommendations
	const hasActionable = result.recommendations.some(
		(r) =>
			r.category === "monitoring" ||
			r.category === "config_change" ||
			r.category === "code_fix",
	);
	if (!hasActionable) {
		errors.push("No actionable recommendations found");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
