// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type TimelineEntryWithRelations,
} from "@prismalens/contracts";

const statusWord = (s: unknown): string | null =>
	typeof s === "string" && Object.hasOwn(INCIDENT_STATUS_LABEL, s)
		? INCIDENT_STATUS_LABEL[s as IncidentStatus]
		: null;

/** A bare "Status changed" names the state it reached: "Acknowledged", "Alerts cleared". */
export function entryTitle(entry: TimelineEntryWithRelations): string {
	const to = statusWord(entry.metadata?.newStatus);
	return entry.type === "status_changed" &&
		entry.title === "Status changed" &&
		to
		? to
		: entry.title;
}
