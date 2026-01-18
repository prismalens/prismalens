/**
 * Alert Factory
 *
 * Factory functions for creating test alerts with realistic data.
 */

import { faker } from "@faker-js/faker";
import type { AlertContext } from "../../src/types/state.js";

// =============================================================================
// TYPES
// =============================================================================

type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";
type AlertStatus = "triggered" | "acknowledged" | "correlated" | "resolved" | "suppressed";

export interface AlertOptions {
	alertId?: string;
	title?: string;
	description?: string;
	severity?: AlertSeverity;
	status?: AlertStatus;
	source?: string;
	serviceName?: string;
	serviceId?: string;
	repository?: string;
	labels?: Record<string, string>;
	tags?: string[];
	triggeredAt?: string;
	rawPayload?: unknown;
}

// =============================================================================
// BASE FACTORY
// =============================================================================

/**
 * Create a single alert with default or custom values
 */
export function createAlert(options: AlertOptions = {}): AlertContext {
	const alertId = options.alertId ?? `alert-${faker.string.uuid()}`;

	return {
		alertId,
		title: options.title ?? faker.lorem.sentence({ min: 4, max: 8 }),
		description: options.description ?? faker.lorem.paragraph(),
		severity: options.severity ?? faker.helpers.arrayElement(["critical", "high", "medium", "low", "info"]),
		status: options.status ?? "triggered",
		source: options.source ?? faker.helpers.arrayElement(["prometheus", "datadog", "pagerduty", "opsgenie"]),
		serviceId: options.serviceId ?? `svc-${faker.string.nanoid(8)}`,
		serviceName: options.serviceName ?? faker.lorem.word(),
		repository: options.repository ?? `${faker.internet.username()}/${faker.lorem.word()}`,
		labels: options.labels ?? {
			environment: faker.helpers.arrayElement(["production", "staging", "development"]),
			team: faker.helpers.arrayElement(["backend", "frontend", "platform", "data"]),
		},
		tags: options.tags ?? [faker.lorem.word(), faker.lorem.word()],
		triggeredAt: options.triggeredAt ?? faker.date.recent().toISOString(),
		rawPayload: options.rawPayload,
	};
}

/**
 * Create multiple alerts
 */
export function createAlerts(count: number, options: AlertOptions = {}): AlertContext[] {
	return Array.from({ length: count }, (_, i) =>
		createAlert({
			...options,
			alertId: options.alertId ? `${options.alertId}-${i}` : undefined,
		})
	);
}

// =============================================================================
// SPECIALIZED FACTORIES
// =============================================================================

/**
 * Create a critical production alert
 */
export function createCriticalAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		severity: "critical",
		status: "triggered",
		labels: {
			environment: "production",
			...(options.labels ?? {}),
		},
		...options,
	});
}

/**
 * Create a null pointer exception alert
 */
export function createNullPointerAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		title: options.title ?? "NullPointerException in AuthHandler",
		description: options.description ?? "Uncaught exception in authentication handler at line 42",
		severity: options.severity ?? "high",
		labels: {
			error_type: "NullPointerException",
			file: "src/services/auth-handler.ts",
			line: "42",
			...(options.labels ?? {}),
		},
		...options,
	});
}

/**
 * Create a timeout alert
 */
export function createTimeoutAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		title: options.title ?? "Request timeout exceeded",
		description: options.description ?? "Multiple requests exceeded the 30s timeout threshold",
		severity: options.severity ?? "medium",
		labels: {
			error_type: "timeout",
			threshold: "30s",
			...(options.labels ?? {}),
		},
		...options,
	});
}

/**
 * Create a rate limit alert
 */
export function createRateLimitAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		title: options.title ?? "Rate limit threshold exceeded",
		description: options.description ?? "API rate limit reached 95% capacity",
		severity: options.severity ?? "medium",
		labels: {
			error_type: "rate_limit",
			utilization: "95%",
			...(options.labels ?? {}),
		},
		...options,
	});
}

/**
 * Create a deployment failure alert
 */
export function createDeploymentAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		title: options.title ?? "Deployment failed",
		description: options.description ?? "Production deployment failed with exit code 1",
		severity: options.severity ?? "high",
		source: options.source ?? "render",
		labels: {
			error_type: "deployment_failure",
			environment: "production",
			...(options.labels ?? {}),
		},
		...options,
	});
}

/**
 * Create a memory exhaustion alert
 */
export function createMemoryAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		title: options.title ?? "Memory usage critical",
		description: options.description ?? "Container memory usage exceeded 95%",
		severity: options.severity ?? "critical",
		labels: {
			error_type: "memory_exhaustion",
			utilization: "95%",
			threshold: "90%",
			...(options.labels ?? {}),
		},
		...options,
	});
}

/**
 * Create a third-party API failure alert
 */
export function createExternalApiAlert(options: AlertOptions = {}): AlertContext {
	return createAlert({
		title: options.title ?? "External API failure: Stripe",
		description: options.description ?? "Stripe payment API returning 503 errors",
		severity: options.severity ?? "high",
		labels: {
			error_type: "external_api",
			provider: "stripe",
			status_code: "503",
			...(options.labels ?? {}),
		},
		...options,
	});
}

// =============================================================================
// SCENARIO FACTORIES
// =============================================================================

/**
 * Create alerts for a code bug scenario
 */
export function createCodeBugScenarioAlerts(
	serviceName: string = "api-service",
): AlertContext[] {
	return [
		createNullPointerAlert({
			serviceName,
			serviceId: `svc-${faker.string.nanoid(8)}`,
		}),
	];
}

/**
 * Create alerts for a configuration issue scenario
 */
export function createConfigIssueScenarioAlerts(
	serviceName: string = "api-service",
): AlertContext[] {
	return [
		createAlert({
			title: "Environment variable missing: DATABASE_URL",
			description: "Application failed to start due to missing DATABASE_URL",
			severity: "critical",
			serviceName,
			labels: {
				error_type: "config",
				missing_var: "DATABASE_URL",
			},
		}),
	];
}

/**
 * Create alerts for a deployment regression scenario
 */
export function createDeploymentRegressionScenarioAlerts(
	serviceName: string = "api-service",
): AlertContext[] {
	const serviceId = `svc-${faker.string.nanoid(8)}`;
	return [
		createDeploymentAlert({
			serviceName,
			serviceId,
		}),
		createCriticalAlert({
			title: "Error rate spike after deployment",
			description: "500 error rate increased from 0.1% to 15% after latest deployment",
			serviceName,
			serviceId,
		}),
	];
}

/**
 * Create alerts for an external outage scenario
 */
export function createExternalOutageScenarioAlerts(
	serviceName: string = "api-service",
): AlertContext[] {
	return [
		createExternalApiAlert({
			serviceName,
		}),
		createTimeoutAlert({
			title: "Upstream timeout: Stripe API",
			serviceName,
		}),
	];
}
