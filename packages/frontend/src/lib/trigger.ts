// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";

/**
 * What woke the agent (#1020). The shell shows every kind in the same slots;
 * a new kind is one entry here, one icon in `TriggerMark`, and nothing else.
 */
export type TriggerKind = "you" | "alert" | "webhook" | "schedule";

/** Sources that send monitoring alerts, `api` for alerts made through the alerts API; any other webhook source is a plain event. */
const ALERT_SOURCES = new Set([
	"api",
	"prometheus",
	"alertmanager",
	"alertmanager-pull",
	"prometheus-catchup",
	"grafana",
	"datadog",
	"sentry",
	"pagerduty",
	"cloudwatch",
	"azure-monitor",
	"newrelic",
]);

export const TRIGGER_WORD: Record<TriggerKind, string> = {
	you: "Started by you",
	alert: "Started by an alert",
	webhook: "Started by a webhook",
	schedule: "Started by a schedule",
};

/** Home's Send tags its thread; the tag is never shown (#1020 D10). */
export const CHAT_TAG = "chat";

/**
 * A plain chat: started from Home with no alert behind it. It still rides on
 * an incident record until threads stand alone (FOLLOWUPS), so the UI hides
 * the incident facets instead of showing a chat as an incident.
 */
export function isPlainChat(
	incident: Pick<IncidentWithRelations, "tags" | "alertCount" | "alerts">,
): boolean {
	return (
		!!incident.tags?.includes(CHAT_TAG) &&
		!(incident.alertCount ?? incident.alerts?.length ?? 0)
	);
}

/** A webhook from a non-monitoring source is an event: it arrives, it never fires. */
export function isEvent(alert: { source?: string | null }): boolean {
	return !!alert.source && !ALERT_SOURCES.has(alert.source);
}

export function triggerOf(
	incident: Pick<IncidentWithRelations, "alerts" | "alertCount">,
): {
	kind: TriggerKind;
	source: string | null;
} {
	const first = incident.alerts?.[0];
	if (!first && !(incident.alertCount ?? 0))
		return { kind: "you", source: null };
	const source = first?.source ?? null;
	return {
		kind: source && !ALERT_SOURCES.has(source) ? "webhook" : "alert",
		source,
	};
}
