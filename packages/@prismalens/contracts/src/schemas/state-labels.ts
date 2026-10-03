// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The word for each enum value, in one place, so the UI, the Markdown export,
 * the Slack message and the CLI all say the same thing. Exhaustive over each
 * enum: adding a value fails the build here until it has a label.
 */

import type { PermissionMode } from "@prismalens/config/harness";
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
	RunState,
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

export const RUN_STATE_LABEL: Record<RunState, string> = {
	starting: "Starting",
	working: "Working",
	stopping: "Stopping",
	stopped: "Stopped by you",
	failed: "Failed",
	done: "Done",
};

export const INCIDENT_ATTENTION_LABEL: Record<IncidentAttention, string> = {
	unacknowledged: "Needs acknowledging",
	failed_run: "Run failed",
	reopened: "Reopened by you, cause not confirmed",
	awaiting_close: "Alerts cleared, resolve it",
};

/** The access level's word, as the box, the run line and the rail say it (r4 R4.1). */
export const ACCESS_LABEL: Record<PermissionMode, string> = {
	"read-only": "Read-only",
	"read-only-tools": "Read-only with your tools",
	"workspace-write": "Edit the copy",
	"full-access": "Full access",
};

/**
 * One line per level for the box and its menu. Framed as the guardrail the gate
 * is (ADR 0004 §3, r4 R4.1 rev); `access-line.test.ts` checks every refusal it
 * names against the red-team corpus, so no absolute word belongs here.
 */
export const ACCESS_LINE: Record<PermissionMode, string> = {
	"read-only":
		"Reads the copied code and queries the telemetry addresses in the brief. PrismaLens refuses writes, installs, other addresses and other ways out that it can see. A guardrail for an honest agent, not a sandbox.",
	"read-only-tools":
		"Reads the copied code, queries any address with GET and runs the read commands of the CLIs you are signed in to. PrismaLens refuses writes, installs, request bodies and other ways out that it can see. A guardrail for an honest agent, not a sandbox.",
	"workspace-write":
		"Edits the run's throwaway copy, runs its tests and queries any address with GET. PrismaLens refuses writes outside the copy, installs, request bodies and other ways out that it can see. A guardrail for an honest agent, not a sandbox.",
	"full-access":
		"Lets the agent do anything on this machine. PrismaLens allows every request and logs it.",
};

/** The tooltip's and Settings → Agent's second sentence under an access line. */
export const ACCESS_BOUNDARY_NOTE =
	"An operating-system boundary needs Codex's sandbox (Settings, Agent) or a container.";

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
