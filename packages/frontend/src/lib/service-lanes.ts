// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AlertWithRelations,
	IncidentWithRelations,
} from "@prismalens/contracts";

/** The lane for work no service claims; it always sits last. */
export const NO_SERVICE_LANE = "none";

export interface Lane<T> {
	id: string;
	name: string;
	items: T[];
}

export interface ServiceRef {
	id: string;
	name: string;
}

/**
 * Every service an incident touches, its own first (#743). The list payload
 * carries `services`; a single incident from `get` may only carry `service`.
 */
export function incidentServices(
	incident: IncidentWithRelations,
): ServiceRef[] {
	if (incident.services && incident.services.length > 0) {
		return incident.services.map((s) => ({
			id: s.id,
			name: s.displayName ?? s.name,
		}));
	}
	if (incident.service) {
		return [
			{
				id: incident.service.id,
				name: incident.service.displayName || incident.service.name,
			},
		];
	}
	return [];
}

function toLanes<T>(
	items: T[],
	servicesOf: (item: T) => ServiceRef[],
): Lane<T>[] {
	const lanes = new Map<string, Lane<T>>();
	const none: Lane<T> = { id: NO_SERVICE_LANE, name: "No service", items: [] };
	for (const item of items) {
		const services = servicesOf(item);
		if (services.length === 0) {
			none.items.push(item);
			continue;
		}
		for (const s of services) {
			let lane = lanes.get(s.id);
			if (!lane) {
				lane = { id: s.id, name: s.name, items: [] };
				lanes.set(s.id, lane);
			}
			lane.items.push(item);
		}
	}
	const sorted = Array.from(lanes.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	return none.items.length > 0 ? [...sorted, none] : sorted;
}

/**
 * Incidents in one lane per service. An incident that touches several
 * services sits in each of their lanes, in the order it came.
 */
export function incidentLanes(
	incidents: IncidentWithRelations[],
): Lane<IncidentWithRelations>[] {
	return toLanes(incidents, incidentServices);
}

/** The other lanes an incident also sits in, for a quiet `Also in` line. */
export function alsoIn(
	incident: IncidentWithRelations,
	laneId: string,
): string[] {
	return incidentServices(incident)
		.filter((s) => s.id !== laneId)
		.map((s) => s.name);
}

/** Alerts in one lane per the alert's own service. */
export function alertLanes(
	alerts: AlertWithRelations[],
): Lane<AlertWithRelations>[] {
	return toLanes(alerts, (a) =>
		a.service
			? [{ id: a.service.id, name: a.service.displayName || a.service.name }]
			: [],
	);
}
