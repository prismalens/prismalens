// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	AlertStatusSchema,
	IncidentStatusSchema,
	PrioritySchema,
	RecommendationPrioritySchema,
	SeveritySchema,
	WorkflowStatusSchema,
} from "./common.js";
import {
	continuableRun,
	effectiveLiveTurn,
	latestRun,
	liveRun,
	isAlertFiring,
	ALERT_ACTION_FROM,
	ALERT_STATUS_PHASE,
	canAlertAction,
	canIncidentAction,
	canSetIncidentStatus,
	ENDED_INCIDENT_STATUSES,
	incidentAttention,
	INCIDENT_ACTION_FROM,
	INCIDENT_ATTENTIONS,
	isFlapReopen,
	INCIDENT_STATUS_SET_FROM,
	INCIDENT_STATUS_PHASE,
	isIncidentOpen,
	isRunStateLive,
	isWorkflowLive,
	isWorkflowTerminal,
	LIVE_WORKFLOW_STATUSES,
	OPEN_ALERT_STATUSES,
	OPEN_INCIDENT_STATUSES,
	PRIORITY_WEIGHT,
	runState,
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

	it("counts a correlated alert as firing until it resolves (walk f14)", () => {
		expect(isAlertFiring("triggered")).toBe(true);
		expect(isAlertFiring("acknowledged")).toBe(true);
		expect(isAlertFiring("correlated")).toBe(true);
		expect(isAlertFiring("resolved")).toBe(false);
		expect(isAlertFiring("suppressed")).toBe(false);
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
		// One-step Resolve (R1a d2): from every open status and from Alerts cleared.
		expect(canIncidentAction("close", "triggered")).toBe(true);
		expect(canIncidentAction("close", "resolved")).toBe(true);
		expect(canIncidentAction("close", "investigating")).toBe(true);
		expect(canIncidentAction("close", "closed")).toBe(false);
		expect(canIncidentAction("investigate", "monitoring")).toBe(true);
		expect(canIncidentAction("investigate", "closed")).toBe(true);
		expect(canIncidentAction("investigate", "resolved")).toBe(true);
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
		expect(canSetIncidentStatus("triggered", "closed")).toBe(true);
		expect(canSetIncidentStatus("resolved", "closed")).toBe(true);
		expect(canSetIncidentStatus("resolved", "investigating")).toBe(true);
		// A closed incident reopens into investigating and nowhere else (walk u18).
		expect(canSetIncidentStatus("closed", "investigating")).toBe(true);
		expect(canSetIncidentStatus("closed", "triggered")).toBe(false);
		expect(canSetIncidentStatus("closed", "identified")).toBe(false);
		// Reopen undoes the operator's Resolve only; Alerts cleared has nothing to reopen.
		expect(canIncidentAction("reopen", "resolved")).toBe(false);
		expect(canIncidentAction("reopen", "closed")).toBe(true);
		expect(canSetIncidentStatus("triggered", "bogus")).toBe(false);
	});

	it("reads a reopen by the operator as needing them until a run starts (R1a d4)", () => {
		const at = "2026-10-02T17:00:00Z";
		expect(
			incidentAttention("investigating", "completed", {
				reason: "operator",
				at,
				latestRunAt: "2026-10-02T16:00:00Z",
			}),
		).toBe("reopened");
		expect(
			incidentAttention("investigating", null, { reason: "operator", at }),
		).toBe("reopened");
		expect(
			incidentAttention("investigating", "running", {
				reason: "operator",
				at,
				latestRunAt: "2026-10-02T17:01:00Z",
			}),
		).toBeNull();
		expect(
			incidentAttention("triggered", null, { reason: "flap", at }),
		).toBe("unacknowledged");
		expect(isFlapReopen({ reason: "flap", at })).toBe(true);
		expect(isFlapReopen({ reason: "operator", at })).toBe(false);
		expect(isFlapReopen(null)).toBe(false);
		expect(INCIDENT_ATTENTIONS).toEqual([
			"unacknowledged",
			"failed_run",
			"reopened",
			"awaiting_close",
		]);
	});

	it("names why an incident wants a human: a failed run first while open, closing once resolved", () => {
		expect(incidentAttention("triggered", null)).toBe("unacknowledged");
		expect(incidentAttention("resolved", "failed")).toBe("awaiting_close");
		expect(incidentAttention("triggered", "failed")).toBe("failed_run");
		expect(incidentAttention("investigating", "cancelled")).toBeNull();
		expect(incidentAttention("investigating", "completed")).toBeNull();
		expect(incidentAttention("investigating", "running")).toBeNull();
		expect(incidentAttention("resolved", null)).toBe("awaiting_close");
		expect(incidentAttention("closed", "failed")).toBeNull();
	});

	it("says what a run is doing in the run's own words, apart from the incident", () => {
		expect(runState("pending")).toBe("starting");
		expect(runState("running")).toBe("starting");
		expect(runState("running", { hasEvents: true })).toBe("working");
		expect(runState("running", { hasEvents: true, stopRequested: true })).toBe(
			"stopping",
		);
		expect(runState("cancelled")).toBe("stopped");
		expect(runState("failed")).toBe("failed");
		expect(runState("completed")).toBe("done");
		expect(isRunStateLive("stopping")).toBe(true);
		expect(isRunStateLive("stopped")).toBe(false);
	});
});

describe("latestRun (#673: runs as threads)", () => {
	const incident = {
		investigations: [
			{ id: "chat-new", kind: "chat", createdAt: "2026-10-07T12:00:00Z" },
			{ id: "inv", kind: "investigation", createdAt: "2026-10-07T10:00:00Z" },
			{ id: "legacy", createdAt: "2026-10-07T09:00:00Z" },
		],
	};

	it("is the newest of any kind by default", () => {
		expect(latestRun(incident)?.id).toBe("chat-new");
	});

	it("filters by kind, and a row without one is an investigation", () => {
		expect(latestRun(incident, { kind: "investigation" })?.id).toBe("inv");
		expect(
			latestRun(
				{ investigations: [incident.investigations[2]] },
				{ kind: "investigation" },
			)?.id,
		).toBe("legacy");
		expect(latestRun({ investigations: [] }, { kind: "chat" })).toBeNull();
	});
});

describe("liveRun picks the live row, not the newest (#673 w59, OBJ-014)", () => {
	it("finds a resumed older row while newer ones have ended", () => {
		const incident = {
			investigations: [
				{ id: "new-done", status: "completed", createdAt: "2026-10-08T12:00:00Z" },
				{ id: "old-live", status: "running", createdAt: "2026-10-08T09:00:00Z" },
			],
		};
		expect(latestRun(incident)?.id).toBe("new-done");
		expect(liveRun(incident)?.id).toBe("old-live");
	});

	it("is null when nothing is live, pending included as live", () => {
		expect(liveRun({ investigations: [{ id: "a", status: "failed", createdAt: "2026-10-08T09:00:00Z" }] })).toBeNull();
		expect(liveRun({ investigations: [{ id: "p", status: "pending", createdAt: "2026-10-08T09:00:00Z" }] })?.id).toBe("p");
		expect(liveRun({})).toBeNull();
	});

	it("two live rows from old data: the newest, and the caller hears of it once", () => {
		const onMany = vi.fn();
		const incident = {
			investigations: [
				{ id: "older", status: "running", createdAt: "2026-10-08T09:00:00Z" },
				{ id: "newer", status: "pending", createdAt: "2026-10-08T10:00:00Z" },
			],
		};
		expect(liveRun(incident, onMany)?.id).toBe("newer");
		expect(onMany).toHaveBeenCalledTimes(1);
		expect(onMany.mock.calls[0]?.[0]).toHaveLength(2);
	});
});

describe("continuableRun: kind, status, session, report (#673 w59, OBJ-012)", () => {
	const base = { kind: "investigation", status: "cancelled", hasReport: false, sessionKept: true };

	it("admits a reportless stopped or failed investigation whose session was kept", () => {
		expect(continuableRun(base)).toBe(true);
		expect(continuableRun({ ...base, status: "failed" })).toBe(true);
		expect(continuableRun({ ...base, kind: null })).toBe(true);
	});

	it.each([
		["a chat", { kind: "chat" }],
		["a completed run", { status: "completed" }],
		["a live run", { status: "running" }],
		["a run with a report", { hasReport: true }],
		["a run with no session", { sessionKept: false }],
	])("refuses %s", (_name, patch) => {
		expect(continuableRun({ ...base, ...patch })).toBe(false);
	});
});

describe("effectiveLiveTurn (#673 w59, OBJ-021)", () => {
	it("reads the column, else the kind", () => {
		expect(effectiveLiveTurn({ kind: "investigation", liveTurn: "answer" })).toBe("answer");
		expect(effectiveLiveTurn({ kind: "chat", liveTurn: null })).toBe("answer");
		expect(effectiveLiveTurn({ kind: "investigation", liveTurn: null })).toBe("report");
		expect(effectiveLiveTurn({})).toBe("report");
	});
});
