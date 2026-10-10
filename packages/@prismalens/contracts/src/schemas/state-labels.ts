// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The word for each enum value, in one place, so the UI, the Markdown export,
 * the Slack message and the CLI all say the same thing. Exhaustive over each
 * enum: adding a value fails the build here until it has a label.
 */

import type { AccessLevel } from "@prismalens/config/harness";
import type { z } from "zod";
import type {
	AlertStatus,
	EvidenceDirection,
	EvidenceStatus,
	HypothesisStatus,
	IncidentStatus,
	Priority,
	RecommendationPriority,
	RecommendationStatus,
	RootCauseCategory,
	ServiceType,
	Severity,
	TimelineEntryType,
	TimelineSource,
	WorkflowStatus,
} from "./common.js";
import type { RunFidelity } from "./investigation.js";
import type {
	IncidentAction,
	IncidentAttention,
	InvestigationKind,
	LiveTurn,
	RunState,
	TurnOutcome,
} from "./state-semantics.js";

export const SEVERITY_LABEL: Record<Severity, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
	info: "Info",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
	p1: "P1 Critical",
	p2: "P2 High",
	p3: "P3 Medium",
	p4: "P4 Low",
	p5: "P5 Planning",
};

/**
 * One word for the end (R1a d1): stored `closed` is the operator's Resolve,
 * stored `resolved` is the source clearing the alerts. The working phases all
 * read Acknowledged; the run strip says what the agent is doing.
 */
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
	triggered: "Triggered",
	investigating: "Acknowledged",
	identified: "Acknowledged",
	monitoring: "Acknowledged",
	resolved: "Alerts cleared",
	closed: "Resolved",
};

/** The band's words; `close` writes `closed`, which the operator calls Resolve. */
export const INCIDENT_ACTION_LABEL: Record<IncidentAction, string> = {
	acknowledge: "Acknowledge",
	investigate: "Investigate",
	resolve: "Resolve",
	reopen: "Reopen",
	close: "Resolve",
};

/** A new incident whose alert fired after an earlier one ended (R1a d6). */
export const REFIRE_LABEL = "Fired again";

/** An alert's end is the source's, so it reads Cleared, never Resolved (study-v3 §4). */
export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
	triggered: "Triggered",
	acknowledged: "Acknowledged",
	correlated: "Correlated",
	resolved: "Cleared",
	suppressed: "Suppressed",
};

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
	pending: "Pending",
	running: "Running",
	completed: "Completed",
	failed: "Failed",
	cancelled: "Stopped",
};

export const RECOMMENDATION_PRIORITY_LABEL: Record<
	RecommendationPriority,
	string
> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
};

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> =
	{
		pending: "Pending",
		in_progress: "In progress",
		completed: "Completed",
		rejected: "Rejected",
		deferred: "Deferred",
	};

export const ROOT_CAUSE_CATEGORY_LABEL: Record<RootCauseCategory, string> = {
	code: "Code",
	config: "Configuration",
	infrastructure: "Infrastructure",
	external: "External dependency",
	unknown: "Unknown",
};

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
	service: "Service",
	database: "Database",
	queue: "Queue",
	cache: "Cache",
	gateway: "Gateway",
	external: "External",
	infrastructure: "Infrastructure",
};

export const TIMELINE_ENTRY_TYPE_LABEL: Record<TimelineEntryType, string> = {
	incident_created: "Incident created",
	alert_added: "Alert added",
	alert_removed: "Alert removed",
	status_changed: "Status changed",
	severity_changed: "Severity changed",
	assigned: "Assigned",
	investigation_started: "Investigation started",
	investigation_completed: "Investigation completed",
	recommendation_added: "Recommendation added",
	recommendation_completed: "Recommendation completed",
	comment: "Note",
	postmortem_created: "Postmortem created",
	custom: "Custom",
};

export const TIMELINE_SOURCE_LABEL: Record<TimelineSource, string> = {
	system: "System",
	user: "Operator",
	ai_worker: "Agent",
};

export const HYPOTHESIS_STATUS_LABEL: Record<HypothesisStatus, string> = {
	confirmed: "Confirmed",
	supported: "Supported",
	speculative: "Speculative",
	refuted: "Refuted",
};

export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
	verified: "Verified",
	inferred: "Inferred",
};

export const EVIDENCE_DIRECTION_LABEL: Record<EvidenceDirection, string> = {
	supports: "For",
	contradicts: "Against",
};

/** Where a run's model id came from, read as "model x, <label>". */
export const MODEL_SOURCE_LABEL: Record<
	NonNullable<RunFidelity["modelSource"]>,
	string
> = {
	operator: "set in Settings",
	"product-default": "PrismaLens default",
	"harness-default": "the agent's default",
	env: "set in the environment",
};

/** The four permission levels, by their one name (#673 w21, operator 2026-10-10). */
export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
	supervised: "Ask always",
	"auto-edits": "Auto-accept edits",
	auto: "Auto",
	"full-access": "Full access",
};

/** What a level means on any agent; what each agent runs sits on its own row line. */
export const ACCESS_LEVEL_LINE: Record<AccessLevel, string> = {
	supervised:
		"The agent's most cautious mode. Every ask it raises waits for you here; reads and searches run.",
	"auto-edits":
		"File changes the agent asks about are approved by PrismaLens and logged; every other ask waits for you.",
	auto: "The agent's own review mode where it has one. PrismaLens approves what it still asks and logs it.",
	"full-access":
		"The agent's full-access mode. PrismaLens approves what it still asks and logs it. It can do anything your user can on this machine, inside whatever sandbox the agent itself runs.",
};

/** A mode whose sandbox no check proved here; the operator's wording (#811, build-handoff ruling 3). */
export const NO_SANDBOX = "No sandbox on this machine.";

/** Levels a run recorded before the two axes (#778), by the level they read as now. */
export const LEGACY_ACCESS_LEVEL: Record<string, AccessLevel> = {
	"read-only": "supervised",
	"read-only-tools": "supervised",
	"workspace-write": "auto-edits",
	"full-access": "full-access",
};

export const RUN_STATE_LABEL: Record<RunState, string> = {
	starting: "Starting",
	working: "Working",
	stopping: "Stopping",
	stopped: "Stopped by you",
	failed: "Failed",
	done: "Done",
};

/** A chat ends without a report: Ended, and Error for a failure (#673 w59). */
const CHAT_STATE_LABEL: Record<RunState, string> = {
	...RUN_STATE_LABEL,
	failed: "Error",
	done: "Ended",
};

export function runStateLabel(
	kind: InvestigationKind | string | null | undefined,
	state: RunState,
): string {
	return (kind === "chat" ? CHAT_STATE_LABEL : RUN_STATE_LABEL)[state];
}

/** The status line's word for a live turn; a null turn reads plain Working. */
export const LIVE_TURN_LABEL: Record<LiveTurn, string> = {
	report: "Working toward a report",
	answer: "Working on an answer",
};

/** `Last message: …` on an investigation whose follow-up did not answer. */
export const TURN_OUTCOME_LABEL: Record<TurnOutcome, string> = {
	answered: "answered",
	stopped: "stopped by you",
	error: "error",
};

export const INCIDENT_ATTENTION_LABEL: Record<IncidentAttention, string> = {
	unacknowledged: "Needs acknowledging",
	awaiting_approval: "Waiting for your approval",
	failed_run: "Run failed",
	reopened: "Reopened by you, cause not confirmed",
	awaiting_close: "Alerts cleared, resolve it",
};

export interface EnumOption<V extends string> {
	value: V;
	label: string;
}

/** Every value of an enum with its label, in schema order, for a select or a filter. */
export function enumOptions<V extends string>(
	schema: z.ZodEnum<Record<string, V>> | { options: readonly V[] },
	labels: Record<V, string>,
): EnumOption<V>[] {
	return (schema.options as readonly V[]).map((value) => ({
		value,
		label: labels[value],
	}));
}
