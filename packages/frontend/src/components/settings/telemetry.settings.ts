// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const telemetryUsageData = define.setting({
	id: "telemetry.usageData",
	page: "telemetry",
	anchor: "telemetry-row",
	label: "Share usage counts",
	sentence:
		"Feature use under a random install id; never an alert, a repo or a report.",
	also: "telemetry analytics usage data",
});
