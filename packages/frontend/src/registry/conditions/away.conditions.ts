// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const awayHours = define.condition({
	id: "away.hours",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"Back after hours | 3, 4, 1, 12, 14 | The same away list on both devices, landing at the first unseen event, rail marks",
		where: "#1101 bar",
	},
	appliesTo: {
		walks: ["resume-limit"],
		categories: ["3", "4", "1", "12", "14"],
	},
	simulator: "seed.away",
	profile: { hours: 9 },
	measure: [
		{
			state:
				"the same away list on both devices, landing at the first unseen event, rail marks",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "pnpm --filter @prismalens/api seed:away --stamp",
		live: "Home and the list after a 9-hour night: the first visible tab opens the away view, once (a second judge on the same server finds it spent)",
		order: "last",
	},
});
