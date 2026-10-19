// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Severity } from "../../../shared/enums/index.js";
import type { AlertMapper } from "./types.js";
import { first, labelsOf, severityFromPriority } from "./util.js";

/**
 * Datadog's webhook body is whatever the integration's template says. This
 * reads the variables Datadog documents ($ALERT_ID, $ALERT_TRANSITION,
 * $EVENT_TITLE, ...) written as lowercase JSON keys; the docs recipe has the template.
 */
export const mapDatadog: AlertMapper = (p) => {
	const monitorId = first(p.alert_id, p.id);
	if (!monitorId) return [];
	const scope = first(p.alert_scope, p.hostname);

	const transition = first(p.alert_transition, p.alert_status)?.toLowerCase();
	const alertType = first(p.alert_type)?.toLowerCase();
	const resolved =
		transition === "recovered" ||
		transition === "resolved" ||
		alertType === "success";

	const title = first(p.alert_title, p.title, p.event_title)?.replace(
		/^\[[^\]]*\]\s*/,
		"",
	);
	const labels = labelsOf({
		alertname: title,
		monitor_id: monitorId,
		scope,
		host: first(p.hostname),
	});
	const tags = (first(p.tags) ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	for (const tag of tags) {
		const [key, ...rest] = tag.split(":");
		if ((key === "service" || key === "env") && rest.length > 0) {
			labels[key] = rest.join(":");
		}
	}

	let fallback: Severity | undefined;
	if (alertType === "error") fallback = Severity.high;
	else if (alertType === "warning") fallback = Severity.medium;
	else if (alertType === "info") fallback = Severity.info;

	return [
		{
			kind: resolved ? "resolved" : "firing",
			dedupKey: scope ? `${monitorId}:${scope}` : monitorId,
			title: title ?? "Datadog monitor alert",
			description: first(p.body, p.event_msg, p.text_only_msg),
			severity: severityFromPriority(first(p.priority)) ?? fallback,
			sourceUrl: first(p.link, p.url),
			labels,
			tags,
			raw: p,
		},
	];
};
