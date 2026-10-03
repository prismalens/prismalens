// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTIONS,
	type IncidentAttention,
	type IncidentWithRelations,
	incidentAttention,
	isFlapReopen,
} from "@prismalens/contracts";
import type { StateTone } from "@/components/shared/StateWord";

/** Why this incident wants a human: the same predicate the stats route counts with. */
export function attentionFor(
	incident: IncidentWithRelations,
): IncidentAttention | null {
	const run = incident.investigations?.[0];
	return incidentAttention(incident.status, run?.status, {
		reason: incident.reopenReason,
		at: incident.reopenedAt,
		latestRunAt: run?.createdAt,
	});
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
	failed_run: "failed",
	reopened: "failed",
	awaiting_close: "neutral",
};
