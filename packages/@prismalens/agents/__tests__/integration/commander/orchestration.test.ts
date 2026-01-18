/**
 * Commander Orchestration Integration Tests
 *
 * Tests for the Commander agent's incident-centric orchestration capabilities.
 * Verifies that the Commander correctly handles incident context and delegates work.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createCommander,
	createCommanderFromState,
	type CommanderConfig,
} from "../../../src/agents/commander/agent.js";
import {
	buildCommanderPrompt,
	type CommanderIncidentContext,
} from "../../../src/agents/commander/prompts.js";
import { createGitHubIntegration, createRenderIntegration } from "../../factories/integration.factory.js";
import {
	createCodeBugIncident,
	createConfigIssueIncident,
	createInfrastructureIncident,
} from "../../factories/incident.factory.js";
import { createCodeBugScenarioState, createIncidentCentricState } from "../../factories/state.factory.js";
import type { InvestigationState, IncidentContext, AlertContext } from "../../../src/types/state.js";
import { getIncidentDisplayInfo } from "../../../src/types/state.js";

describe("Commander Orchestration", () => {
	describe("Incident-Centric Prompt Generation", () => {
		it("should build prompt with incident context", () => {
			const incidentContext: CommanderIncidentContext = {
				incidentId: "inc-123",
				number: 456,
				title: "Database connection timeout",
				description: "Multiple services experiencing connection timeouts",
				severity: "critical",
				priority: "p1",
				serviceName: "api-gateway",
				alertCount: 3,
				customerImpact: "Users unable to login",
			};

			const prompt = buildCommanderPrompt(incidentContext);

			// Should include incident header
			expect(prompt).toContain("Current Incident: INC-456");
			expect(prompt).toContain("Database connection timeout");

			// Should include severity and priority
			expect(prompt).toContain("CRITICAL");
			expect(prompt).toContain("P1");

			// Should include service and alert count
			expect(prompt).toContain("api-gateway");
			expect(prompt).toContain("Alert Count**: 3");

			// Should include customer impact
			expect(prompt).toContain("Users unable to login");

			// Should include investigation instructions
			expect(prompt).toContain("You are investigating incident");
		});

		it("should handle incident without number", () => {
			const incidentContext: CommanderIncidentContext = {
				incidentId: "inc-no-num",
				title: "Test incident",
				severity: "medium",
				priority: "p3",
				alertCount: 1,
			};

			const prompt = buildCommanderPrompt(incidentContext);

			// Should use incidentId when no number
			expect(prompt).toContain("inc-no-num");
		});

		it("should handle legacy alert-centric context", () => {
			const legacyContext = {
				alertSummary: "High CPU usage on api-server",
				serviceName: "api-server",
				incidentId: "inc-legacy",
				priority: "high" as const,
			};

			const prompt = buildCommanderPrompt(legacyContext);

			// Should still work with legacy format
			expect(prompt).toContain("inc-legacy");
			expect(prompt).toContain("api-server");
			expect(prompt).toContain("High CPU usage");
		});

		it("should generate complete prompt without context", () => {
			const prompt = buildCommanderPrompt();

			// Should still have all the standard sections
			expect(prompt).toContain("Incident Commander");
			expect(prompt).toContain("PLANNER and COORDINATOR");
			expect(prompt).toContain("cartographer");
			expect(prompt).toContain("detective");
			expect(prompt).toContain("surgeon");
		});
	});

	describe("Commander Creation with Incident Context", () => {
		it("should create commander with incident-centric config", () => {
			const { incident } = createCodeBugIncident();

			const config: CommanderConfig = {
				integrations: [createGitHubIntegration()],
				incidentContext: {
					incidentId: incident.incidentId,
					number: incident.number,
					title: incident.title,
					description: incident.description,
					severity: incident.severity,
					priority: incident.priority,
					serviceName: incident.serviceName,
					alertCount: incident.alertCount,
				},
			};

			const commander = createCommander(config);

			// DeepAgent is created successfully
			expect(commander).toBeDefined();
			// Commander has invoke method
			expect(typeof commander.invoke).toBe("function");
		});

		it("should create commander from state with incident", () => {
			const { incident, alerts } = createCodeBugIncident();

			const state = {
				investigationId: "inv-123",
				incidentId: incident.incidentId,
				incident,
				alerts,
				primaryAlert: alerts[0],
				priority: "high" as const,
				integrations: [createGitHubIntegration()],
				// Add remaining required state fields
				messages: [],
				gatheredContext: {},
				hypotheses: [],
				recommendations: [],
				agentExecutions: [],
				agentProgression: {},
				dataQuality: {},
				dataSourcesUsed: [],
				summary: null,
				rootCause: null,
				rootCauseCategory: null,
				confidence: null,
				analysisMethod: null,
				error: null,
				commanderResult: null,
				iterationCount: 0,
				maxIterations: 10,
				status: "pending" as const,
			} as InvestigationState;

			const commander = createCommanderFromState(state);

			// DeepAgent is created successfully
			expect(commander).toBeDefined();
			// Commander has invoke method
			expect(typeof commander.invoke).toBe("function");
		});

		it("should fallback to alert context when no incident", () => {
			const state = {
				investigationId: "inv-456",
				incidentId: "inc-456",
				incident: null,
				alerts: [{
					alertId: "alert-1",
					title: "Test alert",
					severity: "high" as const,
					serviceName: "test-service",
				}],
				primaryAlert: {
					alertId: "alert-1",
					title: "Test alert",
					severity: "high" as const,
					serviceName: "test-service",
				},
				priority: "normal" as const,
				integrations: [],
				messages: [],
				gatheredContext: {},
				hypotheses: [],
				recommendations: [],
				agentExecutions: [],
				agentProgression: {},
				dataQuality: {},
				dataSourcesUsed: [],
				summary: null,
				rootCause: null,
				rootCauseCategory: null,
				confidence: null,
				analysisMethod: null,
				error: null,
				commanderResult: null,
				iterationCount: 0,
				maxIterations: 10,
				status: "pending" as const,
			} as InvestigationState;

			const commander = createCommanderFromState(state);

			expect(commander).toBeDefined();
		});
	});

	describe("Incident Display Info Extraction", () => {
		it("should prefer incident context when available", () => {
			const { incident, alerts } = createCodeBugIncident({
				number: 789,
				title: "Incident Title",
				serviceName: "incident-service",
			});

			// Override alert to have different values
			alerts[0].title = "Alert Title";
			alerts[0].serviceName = "alert-service";

			const state = {
				incident,
				alerts,
				primaryAlert: alerts[0],
				incidentId: incident.incidentId,
				priority: "high" as const,
			} as InvestigationState;

			const displayInfo = getIncidentDisplayInfo(state);

			// Should use incident data, not alert data
			expect(displayInfo.title).toBe("Incident Title");
			expect(displayInfo.serviceName).toBe("incident-service");
			expect(displayInfo.number).toBe(789);
		});

		it("should fallback to alert data when no incident", () => {
			const state = {
				incident: null,
				alerts: [{
					alertId: "a1",
					title: "Alert Title",
					severity: "high" as const,
					serviceName: "alert-service",
				}],
				primaryAlert: {
					alertId: "a1",
					title: "Alert Title",
					severity: "high" as const,
					serviceName: "alert-service",
				},
				incidentId: "inc-fallback",
				priority: "normal" as const,
			} as InvestigationState;

			const displayInfo = getIncidentDisplayInfo(state);

			// Should use alert data
			expect(displayInfo.title).toBe("Alert Title");
			expect(displayInfo.serviceName).toBe("alert-service");
			expect(displayInfo.number).toBeUndefined();
		});

		it("should handle empty state gracefully", () => {
			const state = {
				incident: null,
				alerts: [],
				primaryAlert: null,
				incidentId: "inc-empty",
				priority: "low" as const,
			} as InvestigationState;

			const displayInfo = getIncidentDisplayInfo(state);

			expect(displayInfo.title).toBe("Unknown incident");
			expect(displayInfo.incidentId).toBe("inc-empty");
		});
	});

	describe("Scenario-Based Commander Configuration", () => {
		it("should configure commander for code bug scenario", () => {
			const state = createCodeBugScenarioState();

			expect(state.incident).toBeDefined();
			expect(state.alerts).toBeDefined();
			expect(state.alerts!.length).toBeGreaterThan(0);
			expect(state.integrations).toBeDefined();

			// Incident should have code-related context
			const incident = state.incident as IncidentContext;
			expect(incident.title).toContain("NullPointer");
			expect(incident.tags).toContain("code");
		});

		it("should configure commander for config issue scenario", () => {
			const { incident, alerts } = createConfigIssueIncident("API_KEY");

			expect(incident.title).toContain("Configuration");
			expect(incident.severity).toBe("critical");
			expect(incident.priority).toBe("p1");
			expect(incident.tags).toContain("config");
		});

		it("should configure commander for infrastructure scenario", () => {
			const { incident, alerts } = createInfrastructureIncident();

			expect(incident.title).toContain("Infrastructure");
			expect(incident.tags).toContain("infrastructure");
			expect(alerts.length).toBeGreaterThan(1); // Multi-alert scenario
		});
	});

	describe("Incident-Centric State Factory", () => {
		it("should create state with incident and alerts", () => {
			const state = createIncidentCentricState();

			expect(state.incident).toBeDefined();
			expect(state.alerts).toBeDefined();
			expect(state.incidentId).toBe(state.incident!.incidentId);
		});

		it("should use provided incident", () => {
			const { incident, alerts } = createCodeBugIncident({
				title: "Custom incident",
			});

			const state = createIncidentCentricState({
				incident,
				alerts,
			});

			expect(state.incident!.title).toBe("Custom incident");
		});
	});
});
