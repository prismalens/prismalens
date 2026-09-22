// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The word for each enum value, in one place, so the UI, the Markdown export,
 * the Slack message and the CLI all say the same thing. Exhaustive over each
 * enum: adding a value fails the build here until it has a label.
 */

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

export const SEVERITY_LABEL: Record<Severity, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
	info: "Info",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
	p1: "P1 · Critical",
	p2: "P2 · High",
	p3: "P3 · Medium",
	p4: "P4 · Low",
	p5: "P5 · Planning",
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
	triggered: "Triggered",
	investigating: "Investigating",
	identified: "Identified",
	monitoring: "Monitoring",
	resolved: "Resolved",
	closed: "Closed",
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
	triggered: "Triggered",
	acknowledged: "Acknowledged",
	correlated: "Correlated",
	resolved: "Resolved",
	suppressed: "Suppressed",
};

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
	pending: "Pending",
	running: "Running",
	completed: "Completed",
	failed: "Failed",
	cancelled: "Cancelled",
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

export const FIDELITY_LABEL: Record<RunFidelity["fidelity"], string> = {
	enforced: "Enforced",
	cooperative: "Cooperative",
	advisory: "Advisory",
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
