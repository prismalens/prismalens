// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const twoDevicesSteer = define.condition({
	id: "twoDevices.steer",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote: "The same away list on both devices",
		where:
			"#1101, Simulated conditions, Back after hours (bar text; no operator quote found)",
	},
	appliesTo: { walks: ["answer-ask"], categories: ["5", "8", "3"] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{
			state: "a second device at 390 px steers mid-turn and both devices agree",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
});
