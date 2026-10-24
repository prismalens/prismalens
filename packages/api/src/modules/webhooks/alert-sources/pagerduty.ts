// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Severity } from "../../../shared/enums/index.js";
import type { AlertMapper } from "./types.js";
import { asObject, first, labelsOf, severityFromPriority } from "./util.js";

const FIRING = new Set([
	"incident.triggered",
	"incident.reopened",
	"incident.escalated",
	"incident.unacknowledged",
]);

/** PagerDuty v3 webhooks: incident events only. Acknowledge, assign and the like change nothing here. */
export const mapPagerDuty: AlertMapper = (payload) => {
	const event = asObject(payload.event);
	const data = asObject(event.data);
	const type = first(event.event_type);
	const id = first(data.id);
	if (!type || !id || first(event.resource_type) !== "incident") return [];
	if (!FIRING.has(type) && type !== "incident.resolved") return [];

	const title = first(data.title);
	return [
		{
			kind: type === "incident.resolved" ? "resolved" : "firing",
			dedupKey: id,
			title: title ?? "PagerDuty incident",
			description: first(data.description),
			severity:
				severityFromPriority(first(asObject(data.priority).summary)) ??
				(first(data.urgency) === "high" ? Severity.high : Severity.low),
			sourceUrl: first(data.html_url),
			labels: labelsOf({
				alertname: title,
				service: first(asObject(data.service).summary),
				team: first(
					asObject(Array.isArray(data.teams) ? data.teams[0] : undefined)
						.summary,
				),
				incident_key: first(data.incident_key),
			}),
			raw: payload,
		},
	];
};
