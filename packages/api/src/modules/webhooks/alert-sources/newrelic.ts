// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertMapper } from "./types.js";
import { asObject, first, labelsOf, severityFromPriority } from "./util.js";

/**
 * New Relic. Workflows send an issue (`issueId`, `state` CREATED / ACTIVATED /
 * ACKNOWLEDGED / CLOSED); a classic webhook channel sends an incident
 * (`incident_id`, `current_state` open / closed). An acknowledge changes nothing.
 */
export const mapNewRelic: AlertMapper = (p) => {
	const issueId = first(p.issueId);
	const incidentId = first(p.incident_id);
	const id = issueId ?? incidentId;
	if (!id) return [];

	const state = first(p.state, p.current_state)?.toLowerCase();
	if (state === "acknowledged") return [];
	const resolved = state === "closed";

	const accumulations = asObject(p.accumulations);
	const tags = asObject(accumulations.tag);
	const names = asObject(p.entitiesData).names;
	const targets = Array.isArray(p.targets) ? p.targets : [];
	const condition = first(
		Array.isArray(accumulations.conditionName)
			? accumulations.conditionName[0]
			: undefined,
		p.condition_name,
	);
	const title = first(p.title, p.condition_name, p.incident_name);

	const tagFirst = (key: string) => {
		const v = tags[key];
		return first(Array.isArray(v) ? v[0] : v);
	};

	return [
		{
			kind: resolved ? "resolved" : "firing",
			dedupKey: `${issueId ? "issue" : "incident"}:${id}`,
			title: title ?? "New Relic alert",
			description: first(p.details, p.annotations),
			severity: severityFromPriority(first(p.priority, p.severity)),
			sourceUrl: first(p.issueUrl, p.incident_url),
			labels: labelsOf({
				alertname: condition ?? title,
				policy: first(
					Array.isArray(accumulations.policyName)
						? accumulations.policyName[0]
						: undefined,
					p.policy_name,
				),
				entity: first(
					Array.isArray(names) ? names[0] : undefined,
					asObject(targets[0]).name,
				),
				service: tagFirst("service") ?? tagFirst("appName"),
			}),
			raw: p,
		},
	];
};
