// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const timeZone = define.condition({
	id: "time.zone",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["17", "3"] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{ state: "times show in the viewer's local time, with UTC on hover" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
});
