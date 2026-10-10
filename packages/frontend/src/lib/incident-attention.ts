// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	awaitingApproval,
	INCIDENT_ATTENTIONS,
	type IncidentAttention,
	type IncidentWithRelations,
	incidentAttention,
	isFlapReopen,
	latestRun,
} from "@prismalens/contracts";
import type { StateTone } from "@/components/shared/StateWord";

/** Why this incident wants a human: the same predicate the stats route counts with. */
export function attentionFor(
	incident: IncidentWithRelations,
): IncidentAttention | null {
	// A failed chat stays in its thread; any run since a reopen answers it (#673).
	const investigation = latestRun(incident, { kind: "investigation" });
	return incidentAttention(
		incident.status,
		investigation?.status,
		{
			reason: incident.reopenReason,
			at: incident.reopenedAt,
			latestRunAt: latestRun(incident)?.createdAt,
		},
		awaitingApproval(incident),
	);
}

/** Needs you's order (study-v3 §3.1): firing first, then a failed run, a reopen, Alerts cleared last. */
export function attentionRank(incident: IncidentWithRelations): number {
	const why = attentionFor(incident);
	return why ? INCIDENT_ATTENTIONS.indexOf(why) : INCIDENT_ATTENTIONS.length;
}

/** The source refired inside the flap window and put this incident back. */
export function isBackAgain(incident: IncidentWithRelations): boolean {
	return (
		incident.status === "triggered" &&
		isFlapReopen({ reason: incident.reopenReason, at: incident.reopenedAt })
	);
}

/** Red means a human is needed now (study-v3 §2); Alerts cleared is paperwork, in the plain colour. */
export const attentionTone: Record<IncidentAttention, StateTone> = {
	unacknowledged: "failed",
	awaiting_approval: "failed",
	failed_run: "failed",
	reopened: "failed",
	awaiting_close: "neutral",
};
