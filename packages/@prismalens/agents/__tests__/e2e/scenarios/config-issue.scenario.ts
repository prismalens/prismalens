/**
 * Configuration Issue Scenario
 *
 * E2E test scenario for investigating configuration-related incidents.
 * Uses incident-centric approach where incidents are the primary unit.
 */

import type { AlertContext, IncidentContext, IntegrationContext } from "../../../src/types/state.js";
import { createAlert } from "../../factories/alert.factory.js";
import { createConfigIssueIncident } from "../../factories/incident.factory.js";
import { createGitHubIntegration, createRenderIntegration } from "../../factories/integration.factory.js";

// =============================================================================
// SCENARIO DEFINITION
// =============================================================================

export interface ConfigIssueScenarioConfig {
	/** Alert configuration overrides */
	alert?: Partial<AlertContext>;
	/** Incident configuration overrides */
	incident?: Partial<IncidentContext>;
	/** Missing config key */
	missingKey?: string;
	/** Expected outcomes */
	expectations?: {
		minimumConfidence?: number;
		expectedKeywords?: string[];
	};
}

/**
 * Standard config issue scenario: Missing environment variable
 * Returns incident-centric structure with incident as primary unit and alerts as supporting data.
 */
export function createConfigIssueScenario(config: ConfigIssueScenarioConfig = {}): {
	investigationId: string;
	incidentId: string;
	priority: "critical";
	/** The incident being investigated (primary unit) */
	incident: IncidentContext;
	/** Supporting alerts within the incident */
	alerts: AlertContext[];
	integrations: IntegrationContext[];
	expectations: {
		minimumConfidence: number;
		expectedCategory: "config";
		expectedTools: string[];
		expectedKeywords: string[];
	};
} {
	const missingKey = config.missingKey ?? "DATABASE_URL";

	// Create incident with alert using incident factory
	const { incident, alerts } = createConfigIssueIncident(missingKey, {
		serviceName: "api-service",
		...config.incident,
	});

	// Override alert if custom config provided
	const finalAlerts = config.alert
		? [createAlert({
				title: `Environment variable missing: ${missingKey}`,
				description: `Application failed to start - ${missingKey} is not defined`,
				severity: "critical",
				serviceName: "api-service",
				labels: {
					error_type: "config",
					missing_var: missingKey,
				},
				...config.alert,
			})]
		: alerts;

	const integrations = [
		createGitHubIntegration(),
		createRenderIntegration(),
	];

	return {
		investigationId: `inv-config-issue-${Date.now()}`,
		incidentId: incident.incidentId,
		priority: "critical",
		incident,
		alerts: finalAlerts,
		integrations,
		expectations: {
			minimumConfidence: config.expectations?.minimumConfidence ?? 85,
			expectedCategory: "config",
			expectedTools: [
				"render_get_logs",
				"form_hypothesis",
			],
			expectedKeywords: config.expectations?.expectedKeywords ?? [
				missingKey.toLowerCase(),
				"environment",
				"variable",
			],
		},
	};
}

// =============================================================================
// MOCK RESPONSES
// =============================================================================

/**
 * Expected log entries showing the config error
 */
export const expectedLogEntries = [
	{
		id: "log-1",
		timestamp: new Date(Date.now() - 60000).toISOString(),
		message: "[api-service] Starting application...",
		level: "info",
	},
	{
		id: "log-2",
		timestamp: new Date(Date.now() - 55000).toISOString(),
		message: "[api-service] Loading configuration...",
		level: "info",
	},
	{
		id: "log-3",
		timestamp: new Date(Date.now() - 50000).toISOString(),
		message: "Error: DATABASE_URL is not defined",
		level: "error",
	},
	{
		id: "log-4",
		timestamp: new Date(Date.now() - 50000).toISOString(),
		message: "[api-service] Process exited with code 1",
		level: "error",
	},
];

/**
 * Expected hypothesis from Detective
 */
export const expectedHypothesis = {
	claim: "Application failed to start due to missing DATABASE_URL environment variable",
	confidence: 95,
	category: "config",
	evidence: [
		"Logs show 'DATABASE_URL is not defined' error",
		"Application exited immediately after configuration loading",
		"No recent code changes that could cause this",
	],
};

/**
 * Expected recommendation from Surgeon
 */
export const expectedRecommendation = {
	title: "Set DATABASE_URL environment variable",
	category: "config_change",
	priority: "critical",
	urgency: "immediate",
	description: "Add the DATABASE_URL environment variable to the service configuration in Render dashboard",
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate config issue investigation result
 */
export function validateConfigIssueResult(result: {
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
	if (result.rootCauseCategory !== "config") {
		errors.push(`Expected category 'config', got '${result.rootCauseCategory}'`);
	}

	// Check confidence (should be high for clear config errors)
	if (!result.confidence || result.confidence < 85) {
		errors.push(`Expected confidence >= 85, got ${result.confidence}`);
	}

	// Check hypotheses
	if (result.hypotheses.length === 0) {
		errors.push("No hypotheses formed");
	} else {
		const configHypothesis = result.hypotheses.find((h) => h.category === "config");
		if (!configHypothesis) {
			errors.push("No hypothesis with category 'config' found");
		}
	}

	// Check recommendations
	if (result.recommendations.length === 0) {
		errors.push("No recommendations proposed");
	} else {
		const configChange = result.recommendations.find((r) => r.category === "config_change");
		if (!configChange) {
			errors.push("No config_change recommendation found");
		} else if (configChange.priority !== "critical") {
			errors.push(`Expected critical priority, got ${configChange.priority}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
