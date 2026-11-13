// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const protocolDrift = define.condition({
	id: "protocol.drift",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: "all", categories: ["23"] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{
			state:
				"an unknown agent version and unknown update kinds are skipped or named, never a crash or a blank thread",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
});
