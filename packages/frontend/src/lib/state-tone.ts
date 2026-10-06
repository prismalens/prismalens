// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_PHASE,
	type AlertStatus,
	EVIDENCE_STATUS_PHASE,
	type EvidenceStatus,
	HYPOTHESIS_STATUS_PHASE,
	type HypothesisStatus,
	INCIDENT_STATUS_PHASE,
	type IncidentStatus,
	isRunStateLive,
	PRIORITY_WEIGHT,
	type Priority,
	RECOMMENDATION_PRIORITY_WEIGHT,
	type RecommendationPriority,
	type RunState,
	SEVERITY_WEIGHT,
	type Severity,
	type StatePhase,
	type StateWeight,
	WORKFLOW_STATUS_PHASE,
	type WorkflowStatus,
} from "@prismalens/contracts";
import type { StateTone } from "@/components/shared/StateWord";

/**
 * The only place a state becomes a colour (look ruling §1.3). The meaning of
 * each value is the contracts package's (state-semantics); this file says how
 * a meaning looks. One hue per meaning; everything else is neutral.
 */
const severityToneOf: Record<StateWeight, StateTone> = {
	critical: "danger",
	high: "sev-high",
	medium: "warn",
	low: "sev-low",
	info: "quiet",
};

/** Do now: critical / high / medium / low read danger / sev-high / warn / neutral. */
const priorityToneOf: Record<StateWeight, StateTone> = {
	critical: "danger",
	high: "sev-high",
	medium: "warn",
	low: "neutral",
	info: "neutral",
};

function lookup<K extends string, V>(
	table: Record<K, V>,
	key: string,
): V | undefined {
	return Object.hasOwn(table, key) ? table[key as K] : undefined;
}

export function severityTone(severity: Severity | string): StateTone {
	const weight = lookup(SEVERITY_WEIGHT, severity);
	return weight ? severityToneOf[weight] : "quiet";
}

export function priorityTone(priority: Priority | string): StateTone {
	const weight = lookup(PRIORITY_WEIGHT, priority);
	return weight ? priorityToneOf[weight] : "neutral";
}

export function recommendationPriorityTone(
	priority: RecommendationPriority | string,
): StateTone {
	const weight = lookup(RECOMMENDATION_PRIORITY_WEIGHT, priority.toLowerCase());
	return weight ? priorityToneOf[weight] : "warn";
}

/** Triggered wants a human; being worked is neutral; source cleared is ok; closed is quiet. */
const incidentPhaseTone: Record<StatePhase, StateTone> = {
	new: "danger",
	live: "neutral",
	watch: "neutral",
	done: "ok",
	failed: "danger",
	closed: "quiet",
};

export function incidentStatusTone(status: IncidentStatus | string): StateTone {
	const phase = lookup(INCIDENT_STATUS_PHASE, status);
	return phase ? incidentPhaseTone[phase] : "neutral";
}

/** Firing is danger; acknowledged and correlated neutral; cleared ok; suppressed quiet. */
export function alertStatusTone(status: AlertStatus | string): StateTone {
	const phase = lookup(ALERT_STATUS_PHASE, status);
	return phase ? incidentPhaseTone[phase] : "neutral";
}

/** A persisted run: running live, completed ok, failed danger, cancelled is a stop. */
export function runStatusTone(status: WorkflowStatus | string): StateTone {
	if (status === "cancelled") return "neutral";
	const phase = lookup(WORKFLOW_STATUS_PHASE, status);
	if (!phase) return "neutral";
	if (phase === "live") return "live";
	if (phase === "done") return "ok";
	if (phase === "failed") return "danger";
	return "neutral";
}

/** Confirmed ok, supported reads Likely (accent), speculative Unconfirmed (warn). */
export function hypothesisStatusTone(
	status: HypothesisStatus | string,
): StateTone {
	if (status === "supported") return "accent";
	const phase = lookup(HYPOTHESIS_STATUS_PHASE, status);
	if (phase === "done") return "ok";
	if (phase === "watch") return "warn";
	if (phase === "failed") return "danger";
	return "neutral";
}

export function evidenceStatusTone(status: EvidenceStatus | string): StateTone {
	const phase = lookup(EVIDENCE_STATUS_PHASE, status);
	return phase === "done" ? "ok" : "neutral";
}

/** A run's own state word (#743 §2): live states breathe; a stop is the operator's, neutral. */
export function runStateTone(state: RunState): StateTone {
	if (isRunStateLive(state)) return "live";
	if (state === "stopped") return "neutral";
	return state === "failed" ? "danger" : "ok";
}
