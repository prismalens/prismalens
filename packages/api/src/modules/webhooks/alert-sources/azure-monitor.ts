// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Severity } from "../../../shared/enums/index.js";
import type { AlertMapper } from "./types.js";
import { asObject, first, labelsOf } from "./util.js";

const SEVERITIES: Record<string, Severity> = {
	Sev0: Severity.critical,
	Sev1: Severity.high,
	Sev2: Severity.medium,
	Sev3: Severity.low,
	Sev4: Severity.info,
};

/** Azure Monitor common alert schema. The alert id is the same for the fire and the resolve. */
export const mapAzureMonitor: AlertMapper = (payload) => {
	const data = asObject(payload.data);
	const essentials = asObject(data.essentials);
	const alertId = first(essentials.alertId);
	if (!alertId) return [];

	const targets = Array.isArray(essentials.alertTargetIDs)
		? essentials.alertTargetIDs
		: [];
	const target = first(targets[0]);
	const segments = target?.split("/") ?? [];
	const rule = first(essentials.alertRule);
	const labels = labelsOf({
		alertname: rule,
		resource: segments.at(-1),
		resource_group: segments[segments.indexOf("resourcegroups") + 1],
		subscription: alertId.split("/")[2],
		signal_type: first(essentials.signalType),
		monitoring_service: first(essentials.monitoringService),
		service: first(asObject(data.customProperties).service),
	});
	const severity = first(essentials.severity);

	return [
		{
			kind:
				first(essentials.monitorCondition) === "Resolved"
					? "resolved"
					: "firing",
			dedupKey: alertId,
			title: rule ?? "Azure Monitor alert",
			description: first(essentials.description),
			severity: severity ? SEVERITIES[severity] : undefined,
			sourceUrl: `https://portal.azure.com/#view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId~/${encodeURIComponent(alertId)}`,
			labels,
			raw: payload,
		},
	];
};
