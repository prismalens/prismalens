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

/** An alert fires until it resolves or is suppressed; `correlated` still fires (walk f14). */
export function isAlertFiring(status: string): status is AlertStatus {
	return (OPEN_ALERT_STATUSES as readonly string[]).includes(status);
}

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
	| "reopen"
	| "close";

export const INCIDENT_ACTION_FROM: Record<
	IncidentAction,
	readonly IncidentStatus[]
> = {
	acknowledge: ["triggered"],
	// A resolved incident can be investigated again; its status stays (#743).
	investigate: keysWhere(INCIDENT_STATUS_PHASE, () => true),
	// The source's own ending (alerts cleared); no operator button writes it.
	resolve: OPEN_INCIDENT_STATUSES,
	// Only the operator's Resolve (stored `closed`) is undone by Reopen (R1a d4);
	// on Alerts cleared there is nothing to reopen.
	reopen: ["closed"],
	// The operator's one step, shown as Resolve, from every open status and
	// from Alerts cleared (R1a d2).
	close: [...OPEN_INCIDENT_STATUSES, "resolved"],
};

/** The status each action writes; `investigate` leaves the status as it is. */
export const INCIDENT_ACTION_WRITES: Partial<
	Record<IncidentAction, IncidentStatus>
> = {
	acknowledge: "investigating",
	resolve: "resolved",
	reopen: "investigating",
	close: "closed",
};

/**
 * The band's lifecycle actions, in the order its primary is picked (R1a d7).
 * `resolve` is the source's ending and has no button: its word is "Alerts cleared".
 */
export const BAND_ACTIONS: readonly IncidentAction[] = [
	"acknowledge",
	"close",
	"reopen",
];

export function canIncidentAction(
	action: IncidentAction,
	status: string,
): boolean {
	return (INCIDENT_ACTION_FROM[action] as readonly string[]).includes(status);
}

/**
 * Which statuses a generic update may move an incident *from*, per target.
 * Resolving and closing keep their own routes (they stamp the times); this is
 * the rule for a status set on `PATCH /incidents/:id`, which the record uses
 * to acknowledge and to move between the working phases. Never backwards to
 * triggered; out of closed only into investigating (a reopen).
 */
export const INCIDENT_STATUS_SET_FROM: Record<
	IncidentStatus,
	readonly IncidentStatus[]
> = {
	triggered: [],
	investigating: [
		"triggered",
		"identified",
		"monitoring",
		"resolved",
		"closed",
	],
	identified: ["investigating", "monitoring"],
	monitoring: ["investigating", "identified"],
	resolved: INCIDENT_ACTION_FROM.resolve,
	closed: INCIDENT_ACTION_FROM.close,
};

export function canSetIncidentStatus(from: string, to: string): boolean {
	if (from === to) return true;
	const allowed = INCIDENT_STATUS_SET_FROM[to as IncidentStatus];
	return allowed !== undefined && (allowed as readonly string[]).includes(from);
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
	| "awaiting_approval"
	| "failed_run"
	| "reopened"
	| "awaiting_close";

/** The order Needs you lists them in (study-v3 §3.1); Alerts cleared sits last, under "To wrap up". */
export const INCIDENT_ATTENTIONS: readonly IncidentAttention[] = [
	"unacknowledged",
	"awaiting_approval",
	"failed_run",
	"reopened",
	"awaiting_close",
];

/** Why an incident went back to work, and when (R1a d4); null on one never reopened. */
export interface IncidentReopen {
	reason?: string | null;
	at?: string | Date | null;
	/** When the incident's latest run started, if it has one. */
	latestRunAt?: string | Date | null;
}

const time = (v: string | Date | null | undefined): number =>
	v ? new Date(v).getTime() : Number.NaN;

export function incidentAttention(
	status: string,
	latestRunStatus?: string | null,
	reopen?: IncidentReopen | null,
	/** A live run's agent is waiting on an Approve or Deny (#673 w21). */
	awaitingApproval = false,
): IncidentAttention | null {
	if (awaitingApproval) return "awaiting_approval";
	if (status === "resolved") return "awaiting_close";
	if (!isIncidentOpen(status)) return null;
	// A stopped run was the operator's choice; only a failure needs them (#743).
	if (latestRunStatus === "failed") return "failed_run";
	if (INCIDENT_STATUS_PHASE[status as IncidentStatus] === "new")
		return "unacknowledged";
	if (reopen?.reason === "operator") {
		const ranSince = time(reopen.latestRunAt) >= time(reopen.at);
		if (!ranSince) return "reopened";
	}
	return null;
}

/** The source refired inside the flap window and put the incident back (R1a d2). */
export function isFlapReopen(reopen?: IncidentReopen | null): boolean {
	return reopen?.reason === "flap";
}

/**
 * What a run is doing, in the run's own words (#743). Kept apart from the
 * incident's lifecycle so "Investigating" never reads as "an agent is working".
 */
export type RunState =
	| "starting"
	| "working"
	| "stopping"
	| "stopped"
	| "failed"
	| "done";

export function runState(
	status: string,
	opts: { hasEvents?: boolean; stopRequested?: boolean } = {},
): RunState {
	switch (status) {
		case "completed":
			return "done";
		case "failed":
			return "failed";
		case "cancelled":
			return "stopped";
		case "running":
			if (opts.stopRequested) return "stopping";
			return opts.hasEvents ? "working" : "starting";
		default:
			return opts.stopRequested ? "stopping" : "starting";
	}
}

export function isRunStateLive(state: RunState): boolean {
	return state === "starting" || state === "working" || state === "stopping";
}

/** A run is a thread (#673): the alert workflow, or a chat a person's message started. */
export const INVESTIGATION_KINDS = ["investigation", "chat"] as const;
export type InvestigationKind = (typeof INVESTIGATION_KINDS)[number];

/** What a live turn owes (#673 w59): a report, or an answer. */
export const LIVE_TURNS = ["report", "answer"] as const;
export type LiveTurn = (typeof LIVE_TURNS)[number];

/** How a thread's last message ended (#673 w59). */
export const TURN_OUTCOMES = ["answered", "stopped", "error"] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/** A live row's turn; a row claimed before the column existed reads by its kind. */
export function effectiveLiveTurn(row: {
	kind?: string | null;
	liveTurn?: string | null;
}): LiveTurn {
	if (row.liveTurn === "report" || row.liveTurn === "answer")
		return row.liveTurn;
	return row.kind === "chat" ? "answer" : "report";
}

/**
 * A thread `Investigate` can take on to its report in place: an investigation
 * that stopped or failed before writing one, whose session can be reopened.
 */
export function continuableRun(row: {
	kind?: string | null;
	status: string;
	hasReport?: boolean | null;
	/** The session was kept and can be loaded again. */
	sessionKept: boolean;
}): boolean {
	return (
		row.sessionKept &&
		(row.kind ?? "investigation") === "investigation" &&
		(row.status === "cancelled" || row.status === "failed") &&
		!row.hasReport
	);
}

/**
 * The incident's live row: at most one by the admission rule (#673 w59). Old
 * data can hold two; the newest wins and `onMany` hears of it.
 */
export function liveRun<R extends { status: string; createdAt: string | Date }>(
	incident: { investigations?: readonly R[] | null },
	onMany?: (rows: readonly R[]) => void,
): R | null {
	const live = (incident.investigations ?? []).filter((r) =>
		isWorkflowLive(r.status),
	);
	if (live.length > 1) onMany?.(live);
	let newest: R | null = null;
	for (const run of live)
		if (!newest || time(run.createdAt) > time(newest.createdAt)) newest = run;
	return newest;
}

/** The incident's live run is waiting on the operator's Approve or Deny (#673 w21). */
export function awaitingApproval(incident: {
	investigations?:
		| readonly {
				status: string;
				createdAt: string | Date;
				awaitingApprovalAt?: string | Date | null;
		  }[]
		| null;
}): boolean {
	return !!liveRun(incident)?.awaitingApprovalAt;
}

/**
 * The incident's newest run, of `kind` when given. A row from before kinds
 * existed is an investigation. Chats have no report, so a consumer that wants
 * one asks for `investigation` (#673).
 */
export function latestRun<
	R extends { kind?: string | null; createdAt: string | Date },
>(
	incident: { investigations?: readonly R[] | null },
	opts: { kind?: InvestigationKind } = {},
): R | null {
	let newest: R | null = null;
	for (const run of incident.investigations ?? []) {
		if (opts.kind && (run.kind ?? "investigation") !== opts.kind) continue;
		if (!newest || time(run.createdAt) > time(newest.createdAt)) newest = run;
	}
	return newest;
}
