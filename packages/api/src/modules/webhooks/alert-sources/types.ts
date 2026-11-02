// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Severity } from "../../../shared/enums/index.js";

export const ALERT_SOURCES = [
	"grafana",
	"datadog",
	"sentry",
	"pagerduty",
	"cloudwatch",
	"azure-monitor",
	"newrelic",
] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

/**
 * One vendor alert in prismalens's intake shape. `dedupKey` is the vendor's own
 * stable id for the alert, so a repeat folds into one incident and a resolve
 * finds it. `labels` must hold only values that stay the same across repeats
 * (never a metric reading): they are the alert's identity (#79).
 */
export interface MappedAlert {
	kind: "firing" | "resolved";
	dedupKey: string;
	title: string;
	description?: string;
	severity?: Severity;
	sourceUrl?: string;
	labels: Record<string, string>;
	tags?: string[];
	raw: Record<string, unknown>;
}

export type Payload = Record<string, unknown>;
export type AlertMapper = (payload: Payload) => MappedAlert[];
