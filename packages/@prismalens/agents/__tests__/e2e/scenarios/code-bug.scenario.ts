/**
 * Code Bug Scenario
 *
 * E2E test scenario for investigating code-related incidents.
 * Uses incident-centric approach where incidents are the primary unit.
 */

import type { AlertContext, IncidentContext, IntegrationContext } from "../../../src/types/state.js";
import { createNullPointerAlert } from "../../factories/alert.factory.js";
import { createCodeBugIncident } from "../../factories/incident.factory.js";
import { createGitHubIntegration, createRenderIntegration } from "../../factories/integration.factory.js";

// =============================================================================
// SCENARIO DEFINITION
// =============================================================================

export interface CodeBugScenarioConfig {
	/** Alert configuration overrides */
	alert?: Partial<AlertContext>;
	/** Incident configuration overrides */
	incident?: Partial<IncidentContext>;
	/** GitHub integration config */
	github?: {
		owner?: string;
		repo?: string;
	};
	/** Expected outcomes */
	expectations?: {
		minimumConfidence?: number;
		expectedCategory?: "code";
		expectedKeywords?: string[];
	};
}

/**
 * Standard code bug scenario: Null pointer in auth handler
 * Returns incident-centric structure with incident as primary unit and alerts as supporting data.
 */
export function createCodeBugScenario(config: CodeBugScenarioConfig = {}): {
	investigationId: string;
	incidentId: string;
	priority: "high";
	/** The incident being investigated (primary unit) */
	incident: IncidentContext;
	/** Supporting alerts within the incident */
	alerts: AlertContext[];
	integrations: IntegrationContext[];
	expectations: {
		minimumConfidence: number;
		expectedCategory: "code";
		expectedTools: string[];
		expectedKeywords: string[];
	};
} {
	// Create incident with alert using incident factory
	const { incident, alerts } = createCodeBugIncident({
		serviceName: "api-service",
		...config.incident,
	});

	// Override alert if custom config provided
	const finalAlerts = config.alert
		? [createNullPointerAlert({ serviceName: "api-service", ...config.alert })]
		: alerts;

	const integrations = [
		createGitHubIntegration({
			config: {
				owner: config.github?.owner ?? "acme",
				repo: config.github?.repo ?? "api-service",
				defaultBranch: "main",
			},
		}),
		createRenderIntegration(),
	];

	return {
		investigationId: `inv-code-bug-${Date.now()}`,
		incidentId: incident.incidentId,
		priority: "high",
		incident,
		alerts: finalAlerts,
		integrations,
		expectations: {
			minimumConfidence: config.expectations?.minimumConfidence ?? 70,
			expectedCategory: "code",
			expectedTools: [
				"github_search_code",
				"form_hypothesis",
				"propose_fix",
			],
			expectedKeywords: config.expectations?.expectedKeywords ?? [
				"null",
				"auth",
			],
		},
	};
}

// =============================================================================
// MOCK RESPONSES FOR CODE BUG
// =============================================================================

/**
 * Expected code search response for null pointer scenario
 */
export const expectedGitHubSearchResponse = {
	total_count: 1,
	items: [
		{
			name: "auth-handler.ts",
			path: "src/services/auth-handler.ts",
			sha: "abc123",
			html_url: "https://github.com/acme/api-service/blob/main/src/services/auth-handler.ts",
			text_matches: [
				{
					fragment: "NullPointerException",
					matches: [{ text: "NullPointerException", indices: [0, 19] }],
				},
			],
		},
	],
};

/**
 * Expected file content for the buggy file
 */
export const expectedFileContent = `import { User } from '../types';

export function handleAuth(user: User) {
  // Line 42: Bug - Missing null check
  return user.id.toString();
}

export function validateSession(session: Session) {
  return session?.isValid ?? false;
}
`;

/**
 * Expected hypothesis from Detective
 */
export const expectedHypothesis = {
	claim: "Null pointer exception in auth handler due to missing null check on user parameter",
	confidence: 85,
	category: "code",
	evidence: [
		"Stack trace shows NullPointerException at auth-handler.ts line 42",
		"Code at line 42 accesses user.id without null check",
		"Function handleAuth does not validate user parameter",
	],
};

/**
 * Expected recommendation from Surgeon
 */
export const expectedRecommendation = {
	title: "Add null check in auth handler",
	category: "code_fix",
	priority: "high",
	urgency: "immediate",
	codeChanges: [
		{
			filePath: "src/services/auth-handler.ts",
			searchBlock: "return user.id.toString();",
			replaceBlock: `if (!user) {
  throw new Error('User is required');
}
return user.id.toString();`,
			testCase: "Run npm test -- auth-handler.test.ts",
		},
	],
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate code bug investigation result
 */
export function validateCodeBugResult(result: {
	rootCauseCategory: string | null;
	confidence: number | null;
	hypotheses: Array<{ claim: string; confidence: number; category?: string }>;
	recommendations: Array<{ category: string; codeChanges?: unknown[] }>;
}): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// Check root cause category
	if (result.rootCauseCategory !== "code") {
		errors.push(`Expected category 'code', got '${result.rootCauseCategory}'`);
	}

	// Check confidence
	if (!result.confidence || result.confidence < 70) {
		errors.push(`Expected confidence >= 70, got ${result.confidence}`);
	}

	// Check hypotheses
	if (result.hypotheses.length === 0) {
		errors.push("No hypotheses formed");
	} else {
		const codeHypothesis = result.hypotheses.find((h) => h.category === "code");
		if (!codeHypothesis) {
			errors.push("No hypothesis with category 'code' found");
		}
	}

	// Check recommendations
	if (result.recommendations.length === 0) {
		errors.push("No recommendations proposed");
	} else {
		const codeFix = result.recommendations.find((r) => r.category === "code_fix");
		if (!codeFix) {
			errors.push("No code_fix recommendation found");
		} else if (!codeFix.codeChanges || (codeFix.codeChanges as unknown[]).length === 0) {
			errors.push("Code fix recommendation has no code changes");
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
