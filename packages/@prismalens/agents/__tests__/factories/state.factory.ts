/**
 * State Factory
 *
 * Factory functions for creating test investigation states.
 * Supports both incident-centric (preferred) and alert-centric (legacy) patterns.
 */

import { faker } from "@faker-js/faker";
import type {
	InvestigationState,
	AlertContext,
	IncidentContext,
	IntegrationContext,
	Hypothesis,
	Recommendation,
	AgentExecutionRecord,
} from "../../src/types/state.js";
import { createAlert, createAlerts, createNullPointerAlert } from "./alert.factory.js";
import { createHypothesis } from "./hypothesis.factory.js";
import { createRecommendation } from "./recommendation.factory.js";
import { createGitHubIntegration, createRenderIntegration } from "./integration.factory.js";
import {
	createIncident,
	createCodeBugIncident,
	createConfigIssueIncident,
	createInfrastructureIncident,
	createDeploymentRegressionIncident,
	createIncidentWithAlerts,
} from "./incident.factory.js";

// =============================================================================
// TYPES
// =============================================================================

type Priority = "low" | "normal" | "high" | "critical";
type Status = "pending" | "validating" | "running" | "completed" | "failed";
type RootCauseCategory = "code" | "config" | "infrastructure" | "external" | "unknown" | null;

export interface StateOptions {
	investigationId?: string;
	incidentId?: string;
	priority?: Priority;
	status?: Status;
	/** The incident being investigated (preferred over alerts) */
	incident?: IncidentContext;
	/** Alerts associated with the incident */
	alerts?: AlertContext[];
	integrations?: IntegrationContext[];
	hypotheses?: Hypothesis[];
	recommendations?: Recommendation[];
	rootCause?: string | null;
	rootCauseCategory?: RootCauseCategory;
	confidence?: number | null;
	summary?: string | null;
	error?: string | null;
	iterationCount?: number;
	maxIterations?: number;
}

// =============================================================================
// BASE FACTORY
// =============================================================================

/**
 * Create a minimal investigation state (for testing initialization)
 */
export function createMinimalState(options: StateOptions = {}): Partial<InvestigationState> {
	const incidentId = options.incidentId ?? `inc-${faker.string.uuid()}`;

	return {
		investigationId: options.investigationId ?? `inv-${faker.string.uuid()}`,
		incidentId,
		priority: options.priority ?? "normal",
		status: options.status ?? "pending",
		incident: options.incident ?? null,
		alerts: options.alerts ?? [],
		primaryAlert: options.alerts?.[0] ?? null,
		integrations: options.integrations ?? [],
		messages: [],
		gatheredContext: {},
		hypotheses: options.hypotheses ?? [],
		recommendations: options.recommendations ?? [],
		agentExecutions: [],
		agentProgression: {},
		dataQuality: {},
		dataSourcesUsed: [],
		summary: options.summary ?? null,
		rootCause: options.rootCause ?? null,
		rootCauseCategory: options.rootCauseCategory ?? null,
		confidence: options.confidence ?? null,
		analysisMethod: null,
		error: options.error ?? null,
		commanderResult: null,
		iterationCount: options.iterationCount ?? 0,
		maxIterations: options.maxIterations ?? 10,
	};
}

/**
 * Create a full investigation state with realistic data (incident-centric)
 */
export function createFullState(options: StateOptions = {}): Partial<InvestigationState> {
	// Use incident-centric approach if incident provided, otherwise fall back to alerts
	if (options.incident) {
		const alerts = options.alerts ?? [];
		return {
			...createMinimalState(options),
			incident: options.incident,
			alerts,
			primaryAlert: alerts[0] ?? null,
			integrations: options.integrations ?? [
				createGitHubIntegration(),
				createRenderIntegration(),
			],
		};
	}

	// Legacy alert-centric approach
	const alerts = options.alerts ?? createAlerts(1);
	return {
		...createMinimalState(options),
		alerts,
		primaryAlert: alerts[0] ?? null,
		integrations: options.integrations ?? [
			createGitHubIntegration(),
			createRenderIntegration(),
		],
	};
}

/**
 * Create a full investigation state with incident and alerts (preferred)
 */
export function createIncidentCentricState(options: StateOptions = {}): Partial<InvestigationState> {
	const { incident, alerts } = options.incident
		? { incident: options.incident, alerts: options.alerts ?? [] }
		: createIncidentWithAlerts(1);

	return createFullState({
		...options,
		incident,
		alerts,
		incidentId: incident.incidentId,
	});
}

// =============================================================================
// STATUS-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create a pending investigation state (just started)
 */
export function createPendingState(options: StateOptions = {}): Partial<InvestigationState> {
	return createFullState({
		status: "pending",
		iterationCount: 0,
		...options,
	});
}

/**
 * Create a running investigation state (in progress)
 */
export function createRunningState(options: StateOptions = {}): Partial<InvestigationState> {
	return createFullState({
		status: "running",
		iterationCount: options.iterationCount ?? 3,
		agentProgression: {
			cartographer: true,
			detective: false,
			surgeon: false,
		},
		dataSourcesUsed: ["github", "render"],
		...options,
	});
}

/**
 * Create a completed investigation state
 */
export function createCompletedState(options: StateOptions = {}): Partial<InvestigationState> {
	const hypotheses = options.hypotheses ?? [createHypothesis({ confidence: 85 })];
	const recommendations = options.recommendations ?? [createRecommendation()];
	const bestHypothesis = hypotheses.reduce(
		(best, h) => (h.confidence > (best?.confidence ?? 0) ? h : best),
		hypotheses[0]
	);

	return {
		...createFullState(options),
		status: "completed",
		hypotheses,
		recommendations,
		rootCause: options.rootCause ?? bestHypothesis?.claim ?? "Identified root cause",
		rootCauseCategory: options.rootCauseCategory ?? bestHypothesis?.category ?? "code",
		confidence: options.confidence ?? bestHypothesis?.confidence ?? 85,
		summary: options.summary ?? "Investigation completed successfully",
		analysisMethod: "automated",
		agentProgression: {
			cartographer: true,
			detective: true,
			surgeon: true,
		},
		dataSourcesUsed: ["github", "render", "logs"],
	};
}

/**
 * Create a failed investigation state
 */
export function createFailedState(options: StateOptions = {}): Partial<InvestigationState> {
	return createFullState({
		status: "failed",
		error: options.error ?? "Investigation failed due to rate limit exceeded",
		iterationCount: options.iterationCount ?? 5,
		...options,
	});
}

// =============================================================================
// SCENARIO-SPECIFIC FACTORIES (INCIDENT-CENTRIC)
// =============================================================================

/**
 * Create state for a code bug investigation scenario (incident-centric)
 */
export function createCodeBugScenarioState(
	options: StateOptions = {},
): Partial<InvestigationState> {
	const { incident, alerts } = options.incident
		? { incident: options.incident, alerts: options.alerts ?? [createNullPointerAlert()] }
		: createCodeBugIncident({ serviceName: "api-service" });

	return createFullState({
		incident,
		alerts,
		incidentId: incident.incidentId,
		priority: "high",
		integrations: [
			createGitHubIntegration({
				config: {
					owner: "acme",
					repo: "api-service",
					defaultBranch: "main",
				},
			}),
		],
		...options,
	});
}

/**
 * Create state for a configuration issue scenario (incident-centric)
 */
export function createConfigIssueScenarioState(
	options: StateOptions = {},
): Partial<InvestigationState> {
	const { incident, alerts } = options.incident
		? { incident: options.incident, alerts: options.alerts ?? [] }
		: createConfigIssueIncident("DATABASE_URL", { serviceName: "api-service" });

	return createFullState({
		incident,
		alerts,
		incidentId: incident.incidentId,
		priority: "critical",
		integrations: [
			createRenderIntegration(),
		],
		...options,
	});
}

/**
 * Create state for a deployment regression scenario (incident-centric)
 */
export function createDeploymentRegressionState(
	options: StateOptions = {},
): Partial<InvestigationState> {
	const { incident, alerts } = options.incident
		? { incident: options.incident, alerts: options.alerts ?? [] }
		: createDeploymentRegressionIncident({ serviceName: "api-service" });

	return createFullState({
		incident,
		alerts,
		incidentId: incident.incidentId,
		priority: "high",
		integrations: [
			createGitHubIntegration(),
			createRenderIntegration(),
		],
		...options,
	});
}

/**
 * Create state for an infrastructure issue scenario (incident-centric)
 */
export function createInfrastructureScenarioState(
	options: StateOptions = {},
): Partial<InvestigationState> {
	const { incident, alerts } = options.incident
		? { incident: options.incident, alerts: options.alerts ?? [] }
		: createInfrastructureIncident({ serviceName: "api-service" });

	return createFullState({
		incident,
		alerts,
		incidentId: incident.incidentId,
		priority: "critical",
		integrations: [
			createRenderIntegration(),
		],
		...options,
	});
}

/**
 * Create state with low confidence requiring more investigation
 */
export function createLowConfidenceState(
	options: StateOptions = {},
): Partial<InvestigationState> {
	return createRunningState({
		hypotheses: [
			createHypothesis({
				claim: "Possible correlation observed",
				confidence: 45,
				category: "unknown",
			}),
		],
		iterationCount: 5,
		...options,
	});
}

// =============================================================================
// AGENT EXECUTION HELPERS
// =============================================================================

/**
 * Create an agent execution record
 */
export function createAgentExecution(
	agentName: string,
	options: Partial<AgentExecutionRecord> = {},
): AgentExecutionRecord {
	const startedAt = new Date();
	const completedAt = new Date(startedAt.getTime() + faker.number.int({ min: 1000, max: 30000 }));

	return {
		agentName,
		agentType: "llm",
		status: "completed",
		startedAt: startedAt.toISOString(),
		completedAt: completedAt.toISOString(),
		executionTimeMs: completedAt.getTime() - startedAt.getTime(),
		output: null,
		confidence: null,
		inputTokens: faker.number.int({ min: 500, max: 2000 }),
		outputTokens: faker.number.int({ min: 200, max: 1000 }),
		error: null,
		toolExecutions: [],
		...options,
	};
}

/**
 * Create execution records for a full investigation workflow
 */
export function createFullWorkflowExecutions(): AgentExecutionRecord[] {
	return [
		createAgentExecution("cartographer", {
			toolExecutions: [
				{
					toolName: "github_search_code",
					toolCategory: "github",
					arguments: { query: "NullPointerException" },
					result: { matches: 3 },
					status: "success",
					executionTimeMs: 450,
				},
				{
					toolName: "render_get_logs",
					toolCategory: "render",
					arguments: { limit: 100 },
					result: { entries: 100 },
					status: "success",
					executionTimeMs: 320,
				},
			],
		}),
		createAgentExecution("detective", {
			confidence: 85,
			toolExecutions: [
				{
					toolName: "form_hypothesis",
					toolCategory: "hypothesis",
					arguments: { claim: "Null pointer in auth handler" },
					result: { recorded: true },
					status: "success",
					executionTimeMs: 150,
				},
			],
		}),
		createAgentExecution("surgeon", {
			toolExecutions: [
				{
					toolName: "propose_fix",
					toolCategory: "fix-proposal",
					arguments: { title: "Add null check" },
					result: { recorded: true },
					status: "success",
					executionTimeMs: 200,
				},
			],
		}),
	];
}
