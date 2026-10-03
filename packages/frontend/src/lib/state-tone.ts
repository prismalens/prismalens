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
 * The only place a state becomes a colour. The meaning of each value is the
 * contracts package's (state-semantics); this file says how a meaning looks.
 */
const weightTone: Record<StateWeight, StateTone> = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
	info: "info",
};

const phaseTone: Record<StatePhase, StateTone> = {
	new: "critical",
	live: "active",
	watch: "neutral",
	done: "done",
	failed: "failed",
	closed: "neutral",
};

function lookup<K extends string, V>(
	table: Record<K, V>,
	key: string,
): V | undefined {
	return Object.hasOwn(table, key) ? table[key as K] : undefined;
}

export function severityTone(severity: Severity | string): StateTone {
	const weight = lookup(SEVERITY_WEIGHT, severity);
	return weight ? weightTone[weight] : "info";
}

export function recommendationPriorityTone(
	priority: RecommendationPriority | string,
): StateTone {
	const weight = lookup(RECOMMENDATION_PRIORITY_WEIGHT, priority.toLowerCase());
	return weight ? weightTone[weight] : "medium";
}

export function incidentStatusTone(status: IncidentStatus | string): StateTone {
	const phase = lookup(INCIDENT_STATUS_PHASE, status);
	return phase ? phaseTone[phase] : "neutral";
}

export function alertStatusTone(status: AlertStatus | string): StateTone {
	const phase = lookup(ALERT_STATUS_PHASE, status);
	return phase ? phaseTone[phase] : "neutral";
}

export function runStatusTone(status: WorkflowStatus | string): StateTone {
	const phase = lookup(WORKFLOW_STATUS_PHASE, status);
	return phase ? phaseTone[phase] : "neutral";
}

export function hypothesisStatusTone(
	status: HypothesisStatus | string,
): StateTone {
	const phase = lookup(HYPOTHESIS_STATUS_PHASE, status);
	return phase ? phaseTone[phase] : "neutral";
}

export function evidenceStatusTone(status: EvidenceStatus | string): StateTone {
	const phase = lookup(EVIDENCE_STATUS_PHASE, status);
	return phase ? phaseTone[phase] : "neutral";
}

/** A run's own state word (#743 §2): live states pulse, a stop is stale, not failed. */
export function runStateTone(state: RunState): StateTone {
	if (isRunStateLive(state)) return "active";
	if (state === "stopped") return "stale";
	return state === "failed" ? "failed" : "done";
}
