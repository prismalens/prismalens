// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mapPrometheusLabelToSeverity } from "../webhooks.service.js";
import type { AlertMapper, MappedAlert } from "./types.js";
import { asObject, first, labelsOf } from "./util.js";

/** Grafana unified alerting: Alertmanager-shaped, one entry per alert instance. */
export const mapGrafana: AlertMapper = (payload) => {
	const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
	const out: MappedAlert[] = [];
	for (const entry of alerts) {
		const alert = asObject(entry);
		const labels = labelsOf(
			Object.fromEntries(
				Object.entries(asObject(alert.labels)).map(([k, v]) => [k, first(v)]),
			),
		);
		const annotations = asObject(alert.annotations);
		const dedupKey = first(alert.fingerprint, labels.alertname);
		if (!dedupKey) continue;
		out.push({
			kind: alert.status === "resolved" ? "resolved" : "firing",
			dedupKey,
			title: labels.alertname ?? first(payload.title) ?? "Grafana alert",
			description: first(annotations.description, annotations.summary),
			severity: mapPrometheusLabelToSeverity(labels.severity),
			sourceUrl: first(alert.panelURL, alert.generatorURL),
			labels,
			raw: alert,
		});
	}
	return out;
};
