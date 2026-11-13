// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const usageTelemetry = define.condition({
	id: "usage.telemetry",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"the lens of token usage tracking for performance tracking and improvements",
		where:
			"operator, organizer session, 2026-11-11 08:46Z; also 2026-11-12 15:43Z on inference cost, and 2026-11-13 07:17Z on notification cost",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["17"] },
	simulator: "fake.usage-telemetry",
	profile: {
		session: "usage-telemetry",
		turns: 3,
	},
	stage: {
		run: "node scripts/fakes/conditions/session-condition.mjs usage.telemetry --url {url}",
		live: "the thread Checkout 502s with usage on each of its three turns",
	},
	measure: [
		{
			state:
				"a scripted agent reports usage per turn; tokens are shown and recorded",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});
