// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentAttention,
	type IncidentWithRelations,
	incidentAttention,
} from "@prismalens/contracts";
import type { ChipTone } from "@/components/shared/StateChip";

/** Why this incident wants a human: the same predicate the stats route counts with. */
export function attentionFor(
	incident: IncidentWithRelations,
): IncidentAttention | null {
	return incidentAttention(
		incident.status,
		incident.investigations?.[0]?.status,
	);
}

export const attentionTone: Record<IncidentAttention, ChipTone> = {
	failed_run: "failed",
	unacknowledged: "critical",
	awaiting_close: "done",
};
