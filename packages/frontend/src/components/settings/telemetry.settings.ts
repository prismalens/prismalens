// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const telemetryUsageData = define.setting({
	id: "telemetry.usageData",
	page: "telemetry",
	anchor: "telemetry-row",
	label: "Usage data",
	sentence: "Counts of which features get used.",
	also: "telemetry analytics",
});
