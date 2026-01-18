/**
 * Infrastructure Issue Scenario
 *
 * E2E test scenario for investigating infrastructure-related incidents.
 * Tests multi-alert scenarios like memory exhaustion, cascading failures, etc.
 */

import type { AlertContext, IncidentContext, IntegrationContext } from "../../../src/types/state.js";
import {
	createInfrastructureIncident,
	createCascadingFailureIncident,
	createIncidentWithAlerts,
} from "../../factories/incident.factory.js";
import { createRenderIntegration, createGitHubIntegration } from "../../factories/integration.factory.js";

// =============================================================================
// SCENARIO DEFINITIONS
// =============================================================================

export interface InfrastructureScenarioConfig {
	/** Incident configuration overrides */
	incident?: Partial<IncidentContext>;
	/** Alert configuration overrides */
	alerts?: Partial<AlertContext>[];
	/** Expected outcomes */
	expectations?: {
		minimumConfidence?: number;
		expectedCategory?: "infrastructure";
		expectedKeywords?: string[];
	};
}

/**
 * Standard infrastructure scenario: Memory exhaustion
 */
export function createInfrastructureScenario(config: InfrastructureScenarioConfig = {}): {
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
	const { incident, alerts } = createInfrastructureIncident({
		...config.incident,
	});

	const integrations = [
		createRenderIntegration(),
	];

	return {
		investigationId: `inv-infra-${Date.now()}`,
		incidentId: incident.incidentId,
		priority: "critical",
		incident,
		alerts,
		integrations,
		expectations: {
			minimumConfidence: config.expectations?.minimumConfidence ?? 75,
			expectedCategory: "infrastructure",
			expectedTools: [
				"render_get_logs",
				"render_get_deployments",
				"form_hypothesis",
			],
			expectedKeywords: config.expectations?.expectedKeywords ?? [
				"memory",
				"timeout",
				"resource",
			],
		},
	};
}

/**
 * Cascading failure scenario: Multi-service outage
 */
export function createCascadingFailureScenario(
	services: string[] = ["api-gateway", "user-service", "payment-service"],
	config: Partial<InfrastructureScenarioConfig> = {},
): {
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
		affectedServices: string[];
	};
} {
	const { incident, alerts } = createCascadingFailureIncident(services, {
		...config.incident,
	});

	const integrations = [
		createRenderIntegration(),
		createGitHubIntegration(),
	];

	return {
		investigationId: `inv-cascade-${Date.now()}`,
		incidentId: incident.incidentId,
		priority: "critical",
		incident,
		alerts,
		integrations,
		expectations: {
			minimumConfidence: config.expectations?.minimumConfidence ?? 60,
			expectedCategory: "infrastructure",
			expectedTools: [
				"render_get_logs",
				"render_get_deployments",
				"form_hypothesis",
			],
			affectedServices: services,
		},
	};
}

// =============================================================================
// MOCK RESPONSES
// =============================================================================

/**
 * Expected log entries for memory exhaustion
 */
export const expectedMemoryLogs = [
	{
		id: "log-1",
		timestamp: new Date(Date.now() - 300000).toISOString(),
		message: "[api-service] Memory usage: 85%",
		level: "warning",
	},
	{
		id: "log-2",
		timestamp: new Date(Date.now() - 180000).toISOString(),
		message: "[api-service] Memory usage: 92%",
		level: "warning",
	},
	{
		id: "log-3",
		timestamp: new Date(Date.now() - 60000).toISOString(),
		message: "[api-service] Memory usage: 98% - OOMKiller triggered",
		level: "error",
	},
	{
		id: "log-4",
		timestamp: new Date(Date.now() - 55000).toISOString(),
		message: "[api-service] Container restarted due to memory limit",
		level: "error",
	},
];

/**
 * Expected hypothesis for infrastructure issues
 */
export const expectedHypothesis = {
	claim: "Memory exhaustion causing container restarts and request timeouts",
	confidence: 80,
	category: "infrastructure",
	evidence: [
		"Logs show memory usage steadily increasing over time",
		"OOMKiller triggered at 98% memory usage",
		"Container restart correlates with timeout spike",
		"No code changes in the deployment window",
	],
};

/**
 * Expected recommendation for infrastructure issues
 */
export const expectedRecommendation = {
	title: "Increase container memory limit and investigate memory leak",
	category: "monitoring",
	priority: "high",
	urgency: "immediate",
	description: "Increase memory limit to 2GB and add memory profiling to identify leak source",
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate infrastructure investigation result
 */
export function validateInfrastructureResult(result: {
	rootCauseCategory: string | null;
	confidence: number | null;
	hypotheses: Array<{ claim: string; confidence: number; category?: string }>;
	recommendations: Array<{ category: string; priority: string }>;
}): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// Check root cause category
	if (result.rootCauseCategory !== "infrastructure") {
		errors.push(`Expected category 'infrastructure', got '${result.rootCauseCategory}'`);
	}

	// Check confidence
	if (!result.confidence || result.confidence < 60) {
		errors.push(`Expected confidence >= 60, got ${result.confidence}`);
	}

	// Check hypotheses
	if (result.hypotheses.length === 0) {
		errors.push("No hypotheses formed");
	} else {
		const infraHypothesis = result.hypotheses.find(
			(h) => h.category === "infrastructure",
		);
		if (!infraHypothesis) {
			errors.push("No hypothesis with category 'infrastructure' found");
		}
	}

	// Check recommendations
	if (result.recommendations.length === 0) {
		errors.push("No recommendations proposed");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Validate cascading failure investigation covers all affected services
 */
export function validateCascadingFailureResult(
	result: {
		hypotheses: Array<{ claim: string; evidence: string[] }>;
	},
	expectedServices: string[],
): {
	valid: boolean;
	coveredServices: string[];
	missingServices: string[];
} {
	const coveredServices: string[] = [];
	const allText = result.hypotheses
		.map((h) => h.claim + " " + h.evidence.join(" "))
		.join(" ")
		.toLowerCase();

	for (const service of expectedServices) {
		if (allText.includes(service.toLowerCase())) {
			coveredServices.push(service);
		}
	}

	const missingServices = expectedServices.filter(
		(s) => !coveredServices.includes(s),
	);

	return {
		valid: missingServices.length === 0,
		coveredServices,
		missingServices,
	};
}
