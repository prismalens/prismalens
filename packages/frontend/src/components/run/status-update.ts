// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isWorkflowLive,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { firingWord } from "./run-labels";

/** The header's "Write a status update" draft, from what is recorded on the incident (#811). */
export function statusUpdateDraft(
	incident: IncidentWithRelations,
	now: number | null,
): string {
	const service = incident.service
		? `, ${incident.service.displayName || incident.service.name}`
		: "";
	const lines = [
		`INC-${incident.number} ${incident.title}${service}. Severity ${SEVERITY_LABEL[incident.severity]}.`,
	];
	if (incident.status === "closed") lines.push("Resolved.");
	else {
		const firing = firingWord(incident.alerts ?? [], now);
		if (firing) lines.push(`${firing.text}.`);
	}
	const runs = (incident.investigations ?? []).filter(
		(r) => (r.kind ?? "investigation") === "investigation",
	);
	const newest = (rows: typeof runs) =>
		rows.reduce<(typeof runs)[number] | null>(
			(a, r) => (!a || r.createdAt > a.createdAt ? r : a),
			null,
		);
	const cause =
		incident.actualCause ?? newest(runs.filter((r) => r.rootCause))?.rootCause;
	if (cause)
		lines.push(`${incident.actualCause ? "Cause" : "Likely cause"}: ${cause}`);
	else if (runs.some((r) => isWorkflowLive(r.status)))
		lines.push("An investigation is running; no cause yet.");
	else lines.push("No cause found yet.");
	return lines.join("\n");
}
