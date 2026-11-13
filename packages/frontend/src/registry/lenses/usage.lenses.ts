// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const usageTelemetry = define.lens({
	id: "usage.telemetry",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"the lens of token usage tracking for performance tracking and improvements",
		where:
			"operator, organizer session, 2026-11-11 08:46Z; also 2026-11-12 15:43Z on inference cost, and 2026-11-13 07:17Z on notification cost",
	},
	conditions: ["usage.telemetry"],
	rubric:
		"Token and cost use is visible and recorded per turn; polish and notifications are weighed against the inference and attention they cost.",
	status: "active",
});
