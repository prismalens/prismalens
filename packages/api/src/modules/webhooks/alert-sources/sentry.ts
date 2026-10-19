// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Severity } from "../../../shared/enums/index.js";
import type { AlertMapper, MappedAlert } from "./types.js";
import { asObject, first, labelsOf } from "./util.js";

const LEVELS: Record<string, Severity> = {
	fatal: Severity.critical,
	error: Severity.high,
	warning: Severity.medium,
	info: Severity.info,
	debug: Severity.low,
};

function tagValue(tags: unknown, key: string): string | undefined {
	if (!Array.isArray(tags)) return undefined;
	const hit = tags.find((t) => Array.isArray(t) && t[0] === key);
	return hit ? first(hit[1]) : undefined;
}

/**
 * Sentry integration-platform webhooks: issue alerts (`data.event`), metric
 * alerts (`data.metric_alert`) and the `issue` resource (`data.issue`), whose
 * `resolved` action closes an issue-alert incident. The issue is the identity.
 */
export const mapSentry: AlertMapper = (payload) => {
	const action = first(payload.action);
	const data = asObject(payload.data);

	if (data.metric_alert) {
		const metric = asObject(data.metric_alert);
		const rule = asObject(metric.alert_rule);
		const ruleId = first(rule.id, metric.id);
		if (!ruleId) return [];
		return [
			{
				kind: action === "resolved" ? "resolved" : "firing",
				dedupKey: `metric:${ruleId}`,
				title: first(rule.name, metric.title) ?? "Sentry metric alert",
				description: first(data.description_text),
				severity: action === "critical" ? Severity.critical : Severity.medium,
				sourceUrl: first(data.web_url),
				labels: labelsOf({
					alertname: first(rule.name, metric.title),
					project: Array.isArray(metric.projects)
						? first(metric.projects[0])
						: undefined,
				}),
				raw: payload,
			},
		];
	}

	const event = asObject(data.event);
	const issue = asObject(data.issue);
	const issueId = first(event.issue_id, issue.id);
	if (!issueId) return [];

	let kind: MappedAlert["kind"];
	if (data.event) kind = "firing";
	else if (action === "resolved") kind = "resolved";
	else if (action === "created") kind = "firing";
	else return [];

	const title = first(event.title, issue.title);
	const level = first(event.level, issue.level);
	return [
		{
			kind,
			dedupKey: `issue:${issueId}`,
			title: title ?? "Sentry issue",
			description: first(event.culprit, issue.culprit),
			severity: level ? LEVELS[level] : undefined,
			sourceUrl: first(event.web_url, issue.web_url, event.issue_url),
			labels: labelsOf({
				alertname: title,
				project: first(asObject(issue.project).slug, event.project),
				environment: tagValue(event.tags, "environment"),
				service: tagValue(event.tags, "service"),
			}),
			raw: payload,
		},
	];
};
