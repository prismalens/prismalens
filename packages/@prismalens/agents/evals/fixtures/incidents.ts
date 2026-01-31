/**
 * Incident and Alert Fixtures for Evaluations
 *
 * Provides factories for creating test incidents and alerts with realistic data.
 */

import { faker } from "@faker-js/faker";
import type { AlertContext, IncidentContext, IntegrationContext, PreGatheredContext } from "../../src/types/state.js";

// =============================================================================
// SCENARIO DEFINITION
// =============================================================================

export interface ScenarioDefinition {
	/** Unique name for the scenario */
	name: string;
	/** Difficulty level for evaluation */
	difficulty: "easy" | "medium" | "hard";
	/** Root cause category */
	category: "code" | "config" | "infrastructure" | "external" | "unknown";
	/** Input data for the investigation */
	input: {
		investigationId: string;
		incidentId: string;
		priority: "low" | "normal" | "high" | "critical";
		incident: IncidentContext;
		alerts: AlertContext[];
		/** Pre-gathered context for ChangeTracker and other agents */
		preGatheredContext?: PreGatheredContext;
		/** Cloned repository paths (serviceId -> local path) for repo tools */
		clonePaths?: Record<string, string>;
		/** Integration contexts for API-based tools (GitHub, Render, etc.) */
		integrations?: IntegrationContext[];
	};
	/** Expected outputs for assertions */
	expected: {
		status: "completed" | "failed";
		minConfidence: number;
		rootCauseCategory: string;
		shouldHaveRecommendations: boolean;
		/** Optional: specific keywords that should appear in root cause */
		rootCauseKeywords?: string[];
		/** Expected tool calls for trajectory validation (clone scenarios) */
		expectedToolCalls?: string[];
		/** Forbidden tool calls for trajectory validation (non-clone scenarios) */
		forbiddenToolCalls?: string[];
	};
}

// =============================================================================
// INCIDENT FACTORY
// =============================================================================

export interface CreateIncidentOptions {
	incidentId?: string;
	number?: number;
	title?: string;
	description?: string;
	severity?: "critical" | "high" | "medium" | "low" | "info";
	status?: "triggered" | "acknowledged" | "identified" | "resolved" | "closed";
	priority?: "p1" | "p2" | "p3" | "p4";
	serviceName?: string;
	alertCount?: number;
	triggeredAt?: string;
	customerImpact?: string;
}

export function createIncident(options: CreateIncidentOptions = {}): IncidentContext {
	const incidentId = options.incidentId || `inc-${faker.string.alphanumeric(8)}`;

	return {
		incidentId,
		number: options.number || faker.number.int({ min: 1000, max: 9999 }),
		title: options.title || faker.lorem.sentence({ min: 5, max: 10 }),
		description: options.description || faker.lorem.paragraph(),
		severity: options.severity || "high",
		status: options.status || "triggered",
		priority: options.priority || "p2",
		serviceName: options.serviceName || faker.helpers.arrayElement([
			"api-server",
			"web-frontend",
			"auth-service",
			"payment-service",
			"notification-service",
		]),
		alertCount: options.alertCount || faker.number.int({ min: 1, max: 10 }),
		triggeredAt: options.triggeredAt || new Date().toISOString(),
		customerImpact: options.customerImpact,
	};
}

// =============================================================================
// ALERT FACTORY
// =============================================================================

export interface CreateAlertOptions {
	alertId?: string;
	name?: string;
	message?: string;
	severity?: "critical" | "high" | "medium" | "low" | "info";
	source?: string;
	triggeredAt?: string;
	labels?: Record<string, string>;
	annotations?: Record<string, string>;
}

export function createAlert(options: CreateAlertOptions = {}): AlertContext {
	return {
		alertId: options.alertId || `alert-${faker.string.alphanumeric(8)}`,
		name: options.name || faker.helpers.arrayElement([
			"HighErrorRate",
			"HighLatency",
			"HighCPU",
			"HighMemory",
			"ServiceDown",
			"DatabaseConnectionFailed",
		]),
		message: options.message || faker.lorem.sentence(),
		severity: options.severity || "high",
		source: options.source || "prometheus",
		triggeredAt: options.triggeredAt || new Date().toISOString(),
		labels: options.labels || {},
		annotations: options.annotations || {},
	};
}

// =============================================================================
// SCENARIO BUILDERS
// =============================================================================

/**
 * Create a code bug scenario (e.g., NullPointerException)
 */
export function createCodeBugScenario(
	name: string,
	overrides: Partial<ScenarioDefinition> = {},
): ScenarioDefinition {
	const incidentId = `inc-code-${faker.string.alphanumeric(6)}`;
	const investigationId = `eval-code-${faker.string.alphanumeric(6)}`;

	return {
		name,
		difficulty: "easy",
		category: "code",
		input: {
			investigationId,
			incidentId,
			priority: "high",
			incident: createIncident({
				incidentId,
				title: overrides.input?.incident?.title || "High error rate in api-server",
				description: overrides.input?.incident?.description ||
					"NullPointerException in UserService.getUser() causing 500 errors",
				severity: "high",
				serviceName: "api-server",
				alertCount: 3,
			}),
			alerts: overrides.input?.alerts || [
				createAlert({
					name: "HighErrorRate",
					message: "Error rate > 5% for api-server",
					severity: "high",
					annotations: {
						summary: "High 5xx error rate detected",
						description: "api-server returning 500 errors at 8% rate",
					},
				}),
				createAlert({
					name: "ExceptionSpike",
					message: "NullPointerException spike in api-server",
					severity: "high",
					annotations: {
						exception_type: "NullPointerException",
						exception_location: "UserService.getUser()",
						stack_trace: "at UserService.getUser(UserService.java:42)",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 50,
			rootCauseCategory: "code",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["NullPointer", "null", "exception"],
		},
		...overrides,
	};
}

/**
 * Create a config issue scenario (e.g., database connection)
 */
export function createConfigScenario(
	name: string,
	overrides: Partial<ScenarioDefinition> = {},
): ScenarioDefinition {
	const incidentId = `inc-config-${faker.string.alphanumeric(6)}`;
	const investigationId = `eval-config-${faker.string.alphanumeric(6)}`;

	return {
		name,
		difficulty: "medium",
		category: "config",
		input: {
			investigationId,
			incidentId,
			priority: "high",
			incident: createIncident({
				incidentId,
				title: overrides.input?.incident?.title || "Database connection failures",
				description: overrides.input?.incident?.description ||
					"Unable to connect to primary database, connection pool exhausted",
				severity: "critical",
				serviceName: "api-server",
				alertCount: 5,
			}),
			alerts: overrides.input?.alerts || [
				createAlert({
					name: "DatabaseConnectionFailed",
					message: "Cannot establish connection to postgres",
					severity: "critical",
					annotations: {
						database: "primary-db",
						error: "Connection refused: max_connections exceeded",
					},
				}),
				createAlert({
					name: "ConnectionPoolExhausted",
					message: "Database connection pool at 100% capacity",
					severity: "high",
					annotations: {
						pool_size: "100",
						active_connections: "100",
						waiting_requests: "250",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 40,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["connection", "pool", "database", "config"],
		},
		...overrides,
	};
}

/**
 * Create an infrastructure scenario (e.g., high memory)
 */
export function createInfraScenario(
	name: string,
	overrides: Partial<ScenarioDefinition> = {},
): ScenarioDefinition {
	const incidentId = `inc-infra-${faker.string.alphanumeric(6)}`;
	const investigationId = `eval-infra-${faker.string.alphanumeric(6)}`;

	return {
		name,
		difficulty: "medium",
		category: "infrastructure",
		input: {
			investigationId,
			incidentId,
			priority: "critical",
			incident: createIncident({
				incidentId,
				title: overrides.input?.incident?.title || "High memory usage causing OOM kills",
				description: overrides.input?.incident?.description ||
					"Service pods being OOM killed due to memory pressure",
				severity: "critical",
				serviceName: "worker-service",
				alertCount: 4,
			}),
			alerts: overrides.input?.alerts || [
				createAlert({
					name: "HighMemoryUsage",
					message: "Memory usage > 90% for worker-service",
					severity: "critical",
					annotations: {
						memory_usage: "94%",
						memory_limit: "4Gi",
						memory_used: "3.76Gi",
					},
				}),
				createAlert({
					name: "OOMKilled",
					message: "Container killed due to OOM",
					severity: "critical",
					annotations: {
						container: "worker-service",
						exit_code: "137",
						reason: "OOMKilled",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 40,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["memory", "OOM", "resource"],
		},
		...overrides,
	};
}
