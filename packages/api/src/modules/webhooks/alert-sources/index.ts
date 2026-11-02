// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mapAzureMonitor } from "./azure-monitor.js";
import { mapCloudWatch } from "./cloudwatch.js";
import { mapDatadog } from "./datadog.js";
import { mapGrafana } from "./grafana.js";
import { mapNewRelic } from "./newrelic.js";
import { mapPagerDuty } from "./pagerduty.js";
import { mapSentry } from "./sentry.js";
import type { AlertMapper, AlertSource } from "./types.js";

export { confirmSnsSubscription } from "./cloudwatch.js";
export * from "./types.js";

export const ALERT_MAPPERS: Record<AlertSource, AlertMapper> = {
	grafana: mapGrafana,
	datadog: mapDatadog,
	sentry: mapSentry,
	pagerduty: mapPagerDuty,
	cloudwatch: mapCloudWatch,
	"azure-monitor": mapAzureMonitor,
	newrelic: mapNewRelic,
};
