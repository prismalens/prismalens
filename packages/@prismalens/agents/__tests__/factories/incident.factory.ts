/**
 * Incident Factory
 *
 * Factory functions for creating test incidents with realistic data.
 * Incidents are the primary unit of investigation - alerts are grouped into incidents.
 */

import { faker } from "@faker-js/faker";
import type { IncidentContext, AlertContext } from "../../src/types/state.js";
import { createAlert, createNullPointerAlert, createDeploymentAlert, createMemoryAlert, createExternalApiAlert, createTimeoutAlert } from "./alert.factory.js";

// =============================================================================
// TYPES
// =============================================================================

type IncidentSeverity = "critical" | "high" | "medium" | "low" | "info";
type IncidentStatus = "triggered" | "investigating" | "identified" | "monitoring" | "resolved" | "closed";
type IncidentPriority = "p1" | "p2" | "p3" | "p4" | "p5";

export interface IncidentOptions {
	incidentId?: string;
	number?: number;
	title?: string;
	description?: string;
	severity?: IncidentSeverity;
	status?: IncidentStatus;
	priority?: IncidentPriority;
	serviceId?: string;
	serviceName?: string;
	correlationReason?: string;
	alertCount?: number;
	triggeredAt?: string;
	acknowledgedAt?: string;
	tags?: string[];
	customerImpact?: string;
	affectedSystems?: string[];
}

// =============================================================================
// BASE FACTORY
// =============================================================================

/**
 * Create a single incident with default or custom values
 */
export function createIncident(options: IncidentOptions = {}): IncidentContext {
	const incidentId = options.incidentId ?? `inc-${faker.string.uuid()}`;
	const number = options.number ?? faker.number.int({ min: 1, max: 9999 });

	return {
		incidentId,
		number,
		title: options.title ?? faker.lorem.sentence({ min: 4, max: 8 }),
		description: options.description ?? faker.lorem.paragraph(),
		severity: options.severity ?? faker.helpers.arrayElement(["critical", "high", "medium", "low", "info"]),
		status: options.status ?? "triggered",
		priority: options.priority ?? faker.helpers.arrayElement(["p1", "p2", "p3", "p4", "p5"]),
		serviceId: options.serviceId ?? `svc-${faker.string.nanoid(8)}`,
		serviceName: options.serviceName ?? faker.lorem.word(),
		correlationReason: options.correlationReason,
		alertCount: options.alertCount ?? faker.number.int({ min: 1, max: 5 }),
		triggeredAt: options.triggeredAt ?? faker.date.recent().toISOString(),
		acknowledgedAt: options.acknowledgedAt,
		tags: options.tags ?? [faker.lorem.word(), faker.lorem.word()],
		customerImpact: options.customerImpact,
		affectedSystems: options.affectedSystems,
	};
}

// =============================================================================
// SEVERITY-BASED FACTORIES
// =============================================================================

/**
 * Create a critical incident (P1, critical severity)
 */
export function createCriticalIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		severity: "critical",
		priority: "p1",
		status: "triggered",
		...options,
	});
}

/**
 * Create a high priority incident (P2, high severity)
 */
export function createHighPriorityIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		severity: "high",
		priority: "p2",
		status: "triggered",
		...options,
	});
}

/**
 * Create a medium priority incident (P3, medium severity)
 */
export function createMediumPriorityIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		severity: "medium",
		priority: "p3",
		status: "triggered",
		...options,
	});
}

/**
 * Create a low priority incident (P4, low severity)
 */
export function createLowPriorityIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		severity: "low",
		priority: "p4",
		status: "triggered",
		...options,
	});
}

// =============================================================================
// STATUS-BASED FACTORIES
// =============================================================================

/**
 * Create an investigating incident (in progress)
 */
export function createInvestigatingIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		status: "investigating",
		acknowledgedAt: options.acknowledgedAt ?? faker.date.recent().toISOString(),
		...options,
	});
}

/**
 * Create an identified incident (root cause found)
 */
export function createIdentifiedIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		status: "identified",
		acknowledgedAt: options.acknowledgedAt ?? faker.date.recent().toISOString(),
		...options,
	});
}

/**
 * Create a resolved incident
 */
export function createResolvedIncident(options: IncidentOptions = {}): IncidentContext {
	return createIncident({
		status: "resolved",
		acknowledgedAt: options.acknowledgedAt ?? faker.date.recent().toISOString(),
		...options,
	});
}

// =============================================================================
// INCIDENT WITH ALERTS FACTORY
// =============================================================================

export interface IncidentWithAlertsResult {
	incident: IncidentContext;
	alerts: AlertContext[];
}

/**
 * Create an incident with a specified number of associated alerts
 */
export function createIncidentWithAlerts(
	alertCount: number = 1,
	incidentOptions: IncidentOptions = {},
): IncidentWithAlertsResult {
	const serviceId = incidentOptions.serviceId ?? `svc-${faker.string.nanoid(8)}`;
	const serviceName = incidentOptions.serviceName ?? faker.lorem.word();

	const alerts: AlertContext[] = [];
	for (let i = 0; i < alertCount; i++) {
		alerts.push(
			createAlert({
				serviceId,
				serviceName,
				triggeredAt: faker.date.recent().toISOString(),
			})
		);
	}

	const incident = createIncident({
		...incidentOptions,
		serviceId,
		serviceName,
		alertCount,
		title: incidentOptions.title ?? alerts[0]?.title ?? "Correlated incident",
		correlationReason: incidentOptions.correlationReason ?? "Alerts correlated by service and time window",
	});

	return { incident, alerts };
}

// =============================================================================
// SCENARIO-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create a code bug incident with appropriate alerts
 */
export function createCodeBugIncident(
	options: IncidentOptions = {},
): IncidentWithAlertsResult {
	const serviceName = options.serviceName ?? "api-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alert = createNullPointerAlert({
		serviceName,
		serviceId,
	});

	const incident = createIncident({
		title: options.title ?? "NullPointerException in auth handler",
		description: options.description ?? "Uncaught exception in authentication handler causing request failures",
		severity: options.severity ?? "high",
		priority: options.priority ?? "p2",
		serviceName,
		serviceId,
		alertCount: 1,
		correlationReason: "Single alert - no correlation needed",
		tags: ["code", "exception", "auth"],
		...options,
	});

	return { incident, alerts: [alert] };
}

/**
 * Create a configuration issue incident with appropriate alerts
 */
export function createConfigIssueIncident(
	missingKey: string = "DATABASE_URL",
	options: IncidentOptions = {},
): IncidentWithAlertsResult {
	const serviceName = options.serviceName ?? "api-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alert = createAlert({
		title: `Environment variable missing: ${missingKey}`,
		description: `Application failed to start - ${missingKey} is not defined`,
		severity: "critical",
		serviceName,
		serviceId,
		labels: {
			error_type: "config",
			missing_var: missingKey,
		},
	});

	const incident = createIncident({
		title: options.title ?? `Configuration error: Missing ${missingKey}`,
		description: options.description ?? `Service cannot start due to missing environment variable ${missingKey}`,
		severity: options.severity ?? "critical",
		priority: options.priority ?? "p1",
		serviceName,
		serviceId,
		alertCount: 1,
		correlationReason: "Single alert - no correlation needed",
		tags: ["config", "environment", "startup"],
		customerImpact: "Service is down - users cannot access application",
		...options,
	});

	return { incident, alerts: [alert] };
}

/**
 * Create an infrastructure incident with multiple alerts
 */
export function createInfrastructureIncident(
	options: IncidentOptions = {},
): IncidentWithAlertsResult {
	const serviceName = options.serviceName ?? "api-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alerts = [
		createMemoryAlert({
			serviceName,
			serviceId,
		}),
		createTimeoutAlert({
			title: "Request timeout after memory pressure",
			serviceName,
			serviceId,
		}),
	];

	const incident = createIncident({
		title: options.title ?? "Infrastructure issue: Memory exhaustion causing timeouts",
		description: options.description ?? "Container memory usage critical, causing cascading request timeouts",
		severity: options.severity ?? "critical",
		priority: options.priority ?? "p1",
		serviceName,
		serviceId,
		alertCount: alerts.length,
		correlationReason: "Alerts correlated by service and resource metrics",
		tags: ["infrastructure", "memory", "performance"],
		customerImpact: "Degraded performance and request timeouts",
		affectedSystems: [serviceName, "downstream-services"],
		...options,
	});

	return { incident, alerts };
}

/**
 * Create an external outage incident with multiple alerts
 */
export function createExternalOutageIncident(
	provider: string = "stripe",
	options: IncidentOptions = {},
): IncidentWithAlertsResult {
	const serviceName = options.serviceName ?? "payment-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alerts = [
		createExternalApiAlert({
			title: `External API failure: ${provider}`,
			description: `${provider} API returning 503 errors`,
			serviceName,
			serviceId,
			labels: {
				error_type: "external_api",
				provider,
				status_code: "503",
			},
		}),
		createTimeoutAlert({
			title: `Upstream timeout: ${provider} API`,
			serviceName,
			serviceId,
		}),
	];

	const incident = createIncident({
		title: options.title ?? `External service outage: ${provider}`,
		description: options.description ?? `Third-party provider ${provider} is experiencing an outage affecting our service`,
		severity: options.severity ?? "high",
		priority: options.priority ?? "p2",
		serviceName,
		serviceId,
		alertCount: alerts.length,
		correlationReason: `Alerts correlated by external provider: ${provider}`,
		tags: ["external", provider, "outage"],
		customerImpact: `${provider}-related features unavailable`,
		...options,
	});

	return { incident, alerts };
}

/**
 * Create a deployment regression incident
 */
export function createDeploymentRegressionIncident(
	options: IncidentOptions = {},
): IncidentWithAlertsResult {
	const serviceName = options.serviceName ?? "api-service";
	const serviceId = options.serviceId ?? `svc-${faker.string.nanoid(8)}`;

	const alerts = [
		createDeploymentAlert({
			serviceName,
			serviceId,
		}),
		createAlert({
			title: "Error rate spike after deployment",
			description: "500 error rate increased from 0.1% to 15% after latest deployment",
			severity: "critical",
			serviceName,
			serviceId,
			labels: {
				error_type: "regression",
				metric: "error_rate",
			},
		}),
	];

	const incident = createIncident({
		title: options.title ?? "Deployment regression: Error rate spike",
		description: options.description ?? "Recent deployment caused significant increase in error rate",
		severity: options.severity ?? "critical",
		priority: options.priority ?? "p1",
		serviceName,
		serviceId,
		alertCount: alerts.length,
		correlationReason: "Alerts correlated by deployment timing and error metrics",
		tags: ["deployment", "regression", "rollback-candidate"],
		customerImpact: "Users experiencing errors and failed requests",
		...options,
	});

	return { incident, alerts };
}

// =============================================================================
// MULTI-ALERT INCIDENT FACTORIES
// =============================================================================

/**
 * Create a cascading failure incident with alerts from multiple services
 */
export function createCascadingFailureIncident(
	serviceNames: string[] = ["api-gateway", "user-service", "payment-service"],
	options: IncidentOptions = {},
): IncidentWithAlertsResult {
	const alerts: AlertContext[] = serviceNames.map((serviceName, index) =>
		createAlert({
			title: index === 0 ? "Primary service failure" : `Downstream failure: ${serviceName}`,
			description: index === 0
				? "Initial failure in primary service"
				: `Cascading failure from upstream service`,
			severity: index === 0 ? "critical" : "high",
			serviceName,
			serviceId: `svc-${faker.string.nanoid(8)}`,
			labels: {
				error_type: "cascading",
				cascade_level: String(index),
			},
		})
	);

	const incident = createIncident({
		title: options.title ?? "Cascading failure across multiple services",
		description: options.description ?? `Failure in ${serviceNames[0]} caused cascading failures in ${serviceNames.length - 1} downstream services`,
		severity: options.severity ?? "critical",
		priority: options.priority ?? "p1",
		serviceName: serviceNames[0],
		alertCount: alerts.length,
		correlationReason: "Alerts correlated by service dependency graph and timing",
		tags: ["cascading", "multi-service", "dependency"],
		customerImpact: "Multiple services affected - widespread user impact",
		affectedSystems: serviceNames,
		...options,
	});

	return { incident, alerts };
}
