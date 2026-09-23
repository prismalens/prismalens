// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	AlertStatusSchema,
	IncidentStatusSchema,
	PrioritySchema,
	RecommendationPrioritySchema,
	SeveritySchema,
	WorkflowStatusSchema,
} from "./common.js";
import {
	ALERT_ACTION_FROM,
	ALERT_STATUS_PHASE,
	canAlertAction,
	canIncidentAction,
	canSetIncidentStatus,
	ENDED_INCIDENT_STATUSES,
	incidentAttention,
	INCIDENT_ACTION_FROM,
	INCIDENT_STATUS_SET_FROM,
	INCIDENT_STATUS_PHASE,
	isIncidentOpen,
	isWorkflowLive,
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
	OPEN_ALERT_STATUSES,
	OPEN_INCIDENT_STATUSES,
	PRIORITY_WEIGHT,
	RECOMMENDATION_PRIORITY_WEIGHT,
	SEVERITY_WEIGHT,
	TERMINAL_WORKFLOW_STATUSES,
	WORKFLOW_STATUS_PHASE,
} from "./state-semantics.js";

describe("state semantics", () => {
	it("declares a meaning for every enum value", () => {
		expect(Object.keys(SEVERITY_WEIGHT).sort()).toEqual(
			[...SeveritySchema.options].sort(),
		);
		expect(Object.keys(PRIORITY_WEIGHT).sort()).toEqual(
			[...PrioritySchema.options].sort(),
		);
		expect(Object.keys(RECOMMENDATION_PRIORITY_WEIGHT).sort()).toEqual(
			[...RecommendationPrioritySchema.options].sort(),
		);
		expect(Object.keys(INCIDENT_STATUS_PHASE).sort()).toEqual(
			[...IncidentStatusSchema.options].sort(),
		);
		expect(Object.keys(ALERT_STATUS_PHASE).sort()).toEqual(
			[...AlertStatusSchema.options].sort(),
		);
		expect(Object.keys(WORKFLOW_STATUS_PHASE).sort()).toEqual(
			[...WorkflowStatusSchema.options].sort(),
		);
	});

	it("splits incident statuses into open and ended with nothing left over", () => {
		expect([...OPEN_INCIDENT_STATUSES, ...ENDED_INCIDENT_STATUSES].sort()).toEqual(
			[...IncidentStatusSchema.options].sort(),
		);
		expect(ENDED_INCIDENT_STATUSES).toEqual(["resolved", "closed"]);
		expect(isIncidentOpen("investigating")).toBe(true);
		expect(isIncidentOpen("closed")).toBe(false);
		expect(isIncidentOpen("nonsense")).toBe(false);
	});

	it("splits run statuses into live and terminal with nothing left over", () => {
		expect([...LIVE_WORKFLOW_STATUSES, ...TERMINAL_WORKFLOW_STATUSES].sort()).toEqual(
			[...WorkflowStatusSchema.options].sort(),
		);
		expect(LIVE_WORKFLOW_STATUSES).toEqual(["pending", "running"]);
		expect(TERMINAL_WORKFLOW_STATUSES).toEqual(["completed", "failed", "cancelled"]);
		expect(isWorkflowLive("running")).toBe(true);
		expect(isWorkflowTerminal("cancelled")).toBe(true);
		expect(isWorkflowTerminal("running")).toBe(false);
	});

	it("keeps alerts open until they resolve or are suppressed", () => {
		expect(OPEN_ALERT_STATUSES).toEqual(["triggered", "acknowledged", "correlated"]);
	});

	it("admits each operator action only from the statuses that make sense", () => {
		for (const statuses of Object.values(INCIDENT_ACTION_FROM)) {
			for (const s of statuses) expect(IncidentStatusSchema.options).toContain(s);
		}
		for (const statuses of Object.values(ALERT_ACTION_FROM)) {
			for (const s of statuses) expect(AlertStatusSchema.options).toContain(s);
		}
		expect(canIncidentAction("close", "resolved")).toBe(true);
		expect(canIncidentAction("close", "investigating")).toBe(false);
		expect(canIncidentAction("investigate", "monitoring")).toBe(true);
		expect(canIncidentAction("investigate", "closed")).toBe(false);
		expect(canIncidentAction("acknowledge", "identified")).toBe(false);
		expect(canAlertAction("resolve", "acknowledged")).toBe(true);
		expect(canAlertAction("acknowledge", "correlated")).toBe(false);
	});

	it("lets a generic update move only forward through the working phases", () => {
		for (const statuses of Object.values(INCIDENT_STATUS_SET_FROM)) {
			for (const s of statuses) expect(IncidentStatusSchema.options).toContain(s);
		}
		expect(canSetIncidentStatus("triggered", "investigating")).toBe(true);
		expect(canSetIncidentStatus("investigating", "identified")).toBe(true);
		expect(canSetIncidentStatus("monitoring", "investigating")).toBe(true);
		expect(canSetIncidentStatus("identified", "identified")).toBe(true);
		expect(canSetIncidentStatus("investigating", "triggered")).toBe(false);
		expect(canSetIncidentStatus("triggered", "closed")).toBe(false);
		expect(canSetIncidentStatus("closed", "investigating")).toBe(false);
		expect(canSetIncidentStatus("resolved", "closed")).toBe(true);
		expect(canSetIncidentStatus("triggered", "bogus")).toBe(false);
	});

	it("names why an incident wants a human: a failed run first while open, closing once resolved", () => {
		expect(incidentAttention("triggered", null)).toBe("unacknowledged");
		expect(incidentAttention("resolved", "failed")).toBe("awaiting_close");
		expect(incidentAttention("triggered", "failed")).toBe("failed_run");
		expect(incidentAttention("investigating", "cancelled")).toBe("failed_run");
		expect(incidentAttention("investigating", "completed")).toBeNull();
		expect(incidentAttention("investigating", "running")).toBeNull();
		expect(incidentAttention("resolved", null)).toBe("awaiting_close");
		expect(incidentAttention("closed", "failed")).toBeNull();
	});
});
