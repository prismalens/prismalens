// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AlertWithRelations,
	isAlertFiring,
	type Severity,
} from "@prismalens/contracts";

const RANK: Record<Severity, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
};

export interface AlertGroup {
	name: string;
	alerts: AlertWithRelations[];
	firing: number;
	severity: Severity;
	firstAt: string;
	lastAt: string;
}

/**
 * The rule an alert came from: its `alertname` label, else its title up to
 * " on " or ":", less a trailing counter (`Storm alert #5` is `Storm alert`).
 */
export function alertName(alert: AlertWithRelations): string {
	const label = alert.labels?.alertname;
	if (label) return label;
	const cut = alert.title.search(/ on |:/);
	const head = cut > 0 ? alert.title.slice(0, cut) : alert.title;
	return head.replace(/\s*#?\d+$/, "") || head;
}

/** What sets an alert apart inside its group: the title without its rule name. */
export function alertDetail(alert: AlertWithRelations, name: string): string {
	const rest = alert.title.startsWith(name)
		? alert.title.slice(name.length).replace(/^\s*(on\s+|:\s*)?/, "")
		: alert.title;
	return rest || alert.title;
}

/** Alerts grouped by rule, the group with the most firing first (#743). */
export function alertGroups(alerts: AlertWithRelations[]): AlertGroup[] {
	const by = new Map<string, AlertGroup>();
	for (const a of alerts) {
		const name = alertName(a);
		let g = by.get(name);
		if (!g) {
			g = {
				name,
				alerts: [],
				firing: 0,
				severity: a.severity,
				firstAt: a.triggeredAt,
				lastAt: a.lastOccurrence ?? a.triggeredAt,
			};
			by.set(name, g);
		}
		g.alerts.push(a);
		if (isAlertFiring(a.status)) g.firing++;
		if ((RANK[a.severity] ?? 9) < (RANK[g.severity] ?? 9))
			g.severity = a.severity;
		if (a.triggeredAt < g.firstAt) g.firstAt = a.triggeredAt;
		const last = a.lastOccurrence ?? a.triggeredAt;
		if (last > g.lastAt) g.lastAt = last;
	}
	return Array.from(by.values()).sort(
		(x, y) => y.firing - x.firing || y.alerts.length - x.alerts.length,
	);
}
