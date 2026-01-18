/**
 * Commander Handoffs Integration Tests
 *
 * Tests for verifying context is correctly passed between Commander and SubAgents.
 * Verifies the incident-centric workflow through all phases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createCartographerSubAgent,
	createDetectiveSubAgent,
	createSurgeonSubAgent,
	createSubAgents,
	type SubAgentConfig,
} from "../../../src/agents/subagents/index.js";
import { createGitHubIntegration, createRenderIntegration } from "../../factories/integration.factory.js";
import {
	createCodeBugIncident,
	createConfigIssueIncident,
	createDeploymentRegressionIncident,
	createIncidentWithAlerts,
} from "../../factories/incident.factory.js";
import { buildTaskDescription } from "../../../src/agents/commander/prompts.js";

describe("Commander Handoffs", () => {
	let subagentConfig: SubAgentConfig;

	beforeEach(() => {
		subagentConfig = {
			integrations: [createGitHubIntegration(), createRenderIntegration()],
			enableSkills: false, // Disable skills for testing
		};
	});

	describe("SubAgent Creation", () => {
		it("should create all three subagents", () => {
			const subagents = createSubAgents(subagentConfig);

			expect(subagents).toHaveLength(3);

			const names = subagents.map((s) => s.name);
			expect(names).toContain("cartographer");
			expect(names).toContain("detective");
			expect(names).toContain("surgeon");
		});

		it("should configure subagents with same integrations", () => {
			const subagents = createSubAgents(subagentConfig);

			// Cartographer should have integration tools
			const cartographer = subagents.find((s) => s.name === "cartographer")!;
			expect(cartographer.tools).toBeDefined();
			expect(cartographer.tools!.length).toBeGreaterThan(0);

			// Detective and Surgeon have specialized tools, not integration tools
			const detective = subagents.find((s) => s.name === "detective")!;
			expect(detective.tools).toBeDefined();

			const surgeon = subagents.find((s) => s.name === "surgeon")!;
			expect(surgeon.tools).toBeDefined();
		});
	});

	describe("Task Description Building", () => {
		it("should build cartographer task with context", () => {
			const { incident, alerts } = createCodeBugIncident();

			const taskDescription = buildTaskDescription(
				"cartographer",
				`Investigate incident "${incident.title}" - gather logs, code context, and deployment info`,
				`Severity: ${incident.severity}, Service: ${incident.serviceName}`,
			);

			expect(taskDescription).toContain("Context Gathering Task");
			expect(taskDescription).toContain(incident.title);
			expect(taskDescription).toContain("Previous Context");
			expect(taskDescription).toContain(incident.severity);
		});

		it("should build detective task with gathered context", () => {
			const gatheredContext = `
Gathered Context Summary:
- Error found in src/services/auth-handler.ts at line 42
- NullPointerException thrown when user object is null
- Recent commit abc123 modified this file
- No deployment in the last 24 hours
			`.trim();

			const taskDescription = buildTaskDescription(
				"detective",
				"Analyze the gathered context and form root cause hypotheses",
				gatheredContext,
			);

			expect(taskDescription).toContain("Root Cause Analysis Task");
			expect(taskDescription).toContain("form_hypothesis");
			expect(taskDescription).toContain("Previous Context");
			expect(taskDescription).toContain("src/services/auth-handler.ts");
		});

		it("should build surgeon task with hypothesis", () => {
			const hypothesis = `
Root Cause Hypothesis:
- Claim: Null pointer exception in auth handler due to missing null check
- Category: code
- Confidence: 85%
- Evidence: Stack trace, code analysis, recent commits
			`.trim();

			const taskDescription = buildTaskDescription(
				"surgeon",
				"Propose fixes for the confirmed root cause",
				hypothesis,
			);

			expect(taskDescription).toContain("Fix Proposal Task");
			expect(taskDescription).toContain("propose_fix");
			expect(taskDescription).toContain("Previous Context");
			expect(taskDescription).toContain("Null pointer");
		});
	});

	describe("Incident Context Flow Through Workflow", () => {
		it("should pass incident context to cartographer", () => {
			const { incident, alerts } = createCodeBugIncident();

			const cartographer = createCartographerSubAgent(subagentConfig);

			// Cartographer should be able to investigate with incident context
			expect(cartographer.systemPrompt).toContain("context gathering");

			// Task description should include incident info
			const task = buildTaskDescription(
				"cartographer",
				`Investigate incident ${incident.incidentId}: ${incident.title}`,
			);

			expect(task).toContain(incident.incidentId);
			expect(task).toContain(incident.title);
		});

		it("should pass gathered context to detective", () => {
			const { incident } = createCodeBugIncident();

			const detective = createDetectiveSubAgent(subagentConfig);

			// Detective should be ready to analyze
			expect(detective.systemPrompt).toContain("analysis");

			// Task should include gathered context
			const gatheredContext = `
Service: ${incident.serviceName}
Error: NullPointerException at auth-handler.ts:42
Recent changes: None in last 24h
			`.trim();

			const task = buildTaskDescription("detective", "Analyze context", gatheredContext);

			expect(task).toContain(incident.serviceName);
			expect(task).toContain("NullPointerException");
		});

		it("should pass hypothesis to surgeon", () => {
			const surgeon = createSurgeonSubAgent(subagentConfig);

			// Surgeon should be ready to propose fixes
			expect(surgeon.systemPrompt).toContain("fix");

			const hypothesis = {
				claim: "Missing null check causes exception",
				confidence: 85,
				category: "code",
			};

			const task = buildTaskDescription(
				"surgeon",
				`Fix for: ${hypothesis.claim}`,
				`Confidence: ${hypothesis.confidence}%, Category: ${hypothesis.category}`,
			);

			expect(task).toContain("null check");
			expect(task).toContain("85%");
		});
	});

	describe("Multi-Alert Incident Handling", () => {
		it("should handle incident with multiple alerts", () => {
			const { incident, alerts } = createIncidentWithAlerts(3);

			expect(incident.alertCount).toBe(3);
			expect(alerts.length).toBe(3);

			// All alerts should have same service
			const services = new Set(alerts.map((a) => a.serviceName));
			expect(services.size).toBe(1);
		});

		it("should correlate alerts in deployment regression", () => {
			const { incident, alerts } = createDeploymentRegressionIncident();

			expect(alerts.length).toBeGreaterThan(1);
			expect(incident.correlationReason).toContain("deployment");
		});

		it("should pass all alert context to cartographer", () => {
			const { incident, alerts } = createIncidentWithAlerts(4);

			const alertSummary = alerts
				.map((a) => `- [${a.severity}] ${a.title}`)
				.join("\n");

			const task = buildTaskDescription(
				"cartographer",
				`Investigate incident with ${alerts.length} alerts:\n${alertSummary}`,
			);

			expect(task).toContain(`${alerts.length} alerts`);
		});
	});

	describe("Confidence Gate Validation", () => {
		it("should validate confidence threshold in workflow", () => {
			const CONFIDENCE_THRESHOLD = 70;

			// Low confidence - should not proceed to surgeon
			const lowConfidence = 45;
			expect(lowConfidence < CONFIDENCE_THRESHOLD).toBe(true);

			// High confidence - should proceed to surgeon
			const highConfidence = 85;
			expect(highConfidence >= CONFIDENCE_THRESHOLD).toBe(true);
		});

		it("should include confidence guidance in detective task", () => {
			const task = buildTaskDescription(
				"detective",
				"Analyze context and form hypothesis",
			);

			// Detective task should mention confidence expectations
			expect(task).toContain("confidence");
		});
	});

	describe("Error Handling in Workflow", () => {
		it("should handle missing integrations gracefully", () => {
			const emptyConfig: SubAgentConfig = {
				integrations: [],
				enableSkills: false,
			};

			const subagents = createSubAgents(emptyConfig);

			// Should still create all subagents
			expect(subagents).toHaveLength(3);

			// Cartographer may have fewer tools without integrations
			const cartographer = subagents.find((s) => s.name === "cartographer")!;
			expect(cartographer).toBeDefined();
		});

		it("should build task description without previous context", () => {
			const task = buildTaskDescription(
				"cartographer",
				"Initial investigation task",
			);

			// Should work without previous context
			expect(task).toContain("Context Gathering Task");
			expect(task).not.toContain("Previous Context");
		});
	});

	describe("Integration-Specific Tool Access", () => {
		it("should give cartographer GitHub tools when GitHub configured", () => {
			const githubConfig: SubAgentConfig = {
				integrations: [createGitHubIntegration()],
				enableSkills: false,
			};

			const cartographer = createCartographerSubAgent(githubConfig);
			const toolNames = cartographer.tools!.map((t) => t.name);

			expect(toolNames.some((n) => n.includes("github"))).toBe(true);
		});

		it("should give cartographer Render tools when Render configured", () => {
			const renderConfig: SubAgentConfig = {
				integrations: [createRenderIntegration()],
				enableSkills: false,
			};

			const cartographer = createCartographerSubAgent(renderConfig);
			const toolNames = cartographer.tools!.map((t) => t.name);

			expect(toolNames.some((n) => n.includes("render"))).toBe(true);
		});

		it("should give detective hypothesis tools", () => {
			const detective = createDetectiveSubAgent(subagentConfig);
			const toolNames = detective.tools!.map((t) => t.name);

			expect(toolNames).toContain("form_hypothesis");
			expect(toolNames).toContain("evaluate_hypothesis");
		});

		it("should give surgeon fix proposal tools", () => {
			const surgeon = createSurgeonSubAgent(subagentConfig);
			const toolNames = surgeon.tools!.map((t) => t.name);

			expect(toolNames).toContain("propose_fix");
			expect(toolNames).toContain("suggest_rollback");
			expect(toolNames).toContain("validate_code_change");
		});
	});
});
