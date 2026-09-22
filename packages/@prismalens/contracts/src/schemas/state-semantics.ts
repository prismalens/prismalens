// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What each enum value *means*, in one place, so the API and the UI agree on
 * which incidents are still open, which runs have ended, and how heavily a
 * severity or priority weighs. Every table is exhaustive over its enum: adding
 * a value to a schema fails the build here until its meaning is declared.
 */

import type {
	AlertStatus,
	EvidenceStatus,
	HypothesisStatus,
	IncidentStatus,
	Priority,
	RecommendationPriority,
	Severity,
	WorkflowStatus,
} from "./common.js";
import type { RunFidelity } from "./investigation.js";

/** How heavily a thing weighs against the others of its kind. */
export type StateWeight = "critical" | "high" | "medium" | "low" | "info";

/**
 * Where a thing is in its life.
 * `new` wants a human; `live` is being worked; `watch` is being observed;
 * `done` ended well; `failed` ended badly; `closed` is filed away.
 */
export type StatePhase =
	| "new"
	| "live"
	| "watch"
	| "done"
	| "failed"
	| "closed";

export const SEVERITY_WEIGHT: Record<Severity, StateWeight> = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
	info: "info",
};

export const PRIORITY_WEIGHT: Record<Priority, StateWeight> = {
	p1: "critical",
	p2: "high",
	p3: "medium",
	p4: "low",
	p5: "info",
};

export const RECOMMENDATION_PRIORITY_WEIGHT: Record<
	RecommendationPriority,
	StateWeight
> = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
};

export const INCIDENT_STATUS_PHASE: Record<IncidentStatus, StatePhase> = {
	triggered: "new",
	investigating: "live",
	identified: "live",
	monitoring: "watch",
	resolved: "done",
	closed: "closed",
};

export const ALERT_STATUS_PHASE: Record<AlertStatus, StatePhase> = {
	triggered: "new",
	acknowledged: "live",
	correlated: "live",
	resolved: "done",
	suppressed: "closed",
};

export const WORKFLOW_STATUS_PHASE: Record<WorkflowStatus, StatePhase> = {
	pending: "watch",
	running: "live",
	completed: "done",
	failed: "failed",
	cancelled: "failed",
};

export const HYPOTHESIS_STATUS_PHASE: Record<HypothesisStatus, StatePhase> = {
	confirmed: "done",
	supported: "done",
	speculative: "watch",
	refuted: "failed",
};

export const EVIDENCE_STATUS_PHASE: Record<EvidenceStatus, StatePhase> = {
	verified: "done",
	inferred: "watch",
};

/** How much the harness's enforcement can be trusted (ADR-0017). */
export const FIDELITY_PHASE: Record<RunFidelity["fidelity"], StatePhase> = {
	enforced: "done",
	cooperative: "watch",
	advisory: "failed",
};

const ENDED_PHASES: ReadonlySet<StatePhase> = new Set([
	"done",
	"failed",
	"closed",
]);

function keysWhere<K extends string>(
	table: Record<K, StatePhase>,
	pick: (phase: StatePhase) => boolean,
): K[] {
	return (Object.keys(table) as K[]).filter((k) => pick(table[k]));
}

/** Incident statuses that still want work: everything before resolved. */
export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] = keysWhere(
	INCIDENT_STATUS_PHASE,
	(p) => !ENDED_PHASES.has(p),
);

/** Incident statuses that have ended: resolved and closed. */
export const ENDED_INCIDENT_STATUSES: readonly IncidentStatus[] = keysWhere(
	INCIDENT_STATUS_PHASE,
	(p) => ENDED_PHASES.has(p),
);

/** Alert statuses still in play: not resolved, not suppressed. */
export const OPEN_ALERT_STATUSES: readonly AlertStatus[] = keysWhere(
	ALERT_STATUS_PHASE,
	(p) => !ENDED_PHASES.has(p),
);

/** Run statuses that will still change: pending and running. */
export const LIVE_WORKFLOW_STATUSES: readonly WorkflowStatus[] = keysWhere(
	WORKFLOW_STATUS_PHASE,
	(p) => !ENDED_PHASES.has(p),
);

/** Run statuses that are final: completed, failed, cancelled. */
export const TERMINAL_WORKFLOW_STATUSES: readonly WorkflowStatus[] = keysWhere(
	WORKFLOW_STATUS_PHASE,
	(p) => ENDED_PHASES.has(p),
);

export function isIncidentOpen(status: string): status is IncidentStatus {
	return (OPEN_INCIDENT_STATUSES as readonly string[]).includes(status);
}

export function isIncidentEnded(status: string): status is IncidentStatus {
	return (ENDED_INCIDENT_STATUSES as readonly string[]).includes(status);
}

export function isWorkflowLive(status: string): status is WorkflowStatus {
	return (LIVE_WORKFLOW_STATUSES as readonly string[]).includes(status);
}

export function isWorkflowTerminal(status: string): status is WorkflowStatus {
	return (TERMINAL_WORKFLOW_STATUSES as readonly string[]).includes(status);
}

/**
 * Which incident statuses admit each operator action. The API refuses the rest
 * with CONFLICT; the UI hides or greys the control for the same reason.
 */
export type IncidentAction =
	| "acknowledge"
	| "investigate"
	| "resolve"
	| "close";

export const INCIDENT_ACTION_FROM: Record<
	IncidentAction,
	readonly IncidentStatus[]
> = {
	acknowledge: ["triggered"],
	investigate: OPEN_INCIDENT_STATUSES,
	resolve: OPEN_INCIDENT_STATUSES,
	close: ["resolved"],
};

export function canIncidentAction(
	action: IncidentAction,
	status: string,
): boolean {
	return (INCIDENT_ACTION_FROM[action] as readonly string[]).includes(status);
}

export type AlertAction = "acknowledge" | "resolve";

export const ALERT_ACTION_FROM: Record<AlertAction, readonly AlertStatus[]> = {
	acknowledge: ["triggered"],
	resolve: ["triggered", "acknowledged"],
};

export function canAlertAction(action: AlertAction, status: string): boolean {
	return (ALERT_ACTION_FROM[action] as readonly string[]).includes(status);
}

/**
 * Why an incident wants a human right now, derived from data the list already
 * carries. The queue groups these first and the stats route counts them; both
 * read this one predicate so the number and the rows never disagree.
 */
export type IncidentAttention =
	| "unacknowledged"
	| "failed_run"
	| "awaiting_close";

export const INCIDENT_ATTENTIONS: readonly IncidentAttention[] = [
	"failed_run",
	"unacknowledged",
	"awaiting_close",
];

export function incidentAttention(
	status: string,
	latestRunStatus?: string | null,
): IncidentAttention | null {
	if (!isIncidentOpen(status) && status !== "resolved") return null;
	if (
		latestRunStatus &&
		isWorkflowTerminal(latestRunStatus) &&
		latestRunStatus !== "completed"
	) {
		return "failed_run";
	}
	if (INCIDENT_STATUS_PHASE[status as IncidentStatus] === "new")
		return "unacknowledged";
	if (status === "resolved") return "awaiting_close";
	return null;
}
