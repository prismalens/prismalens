// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const hostStandby = define.condition({
	id: "host.standby",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote:
			"the laptop was still on and your cron did not fire since 2pm IST something",
		where: "operator, organizer session, 2026-11-11 11:00Z",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["12", "23", "3"] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{
			state:
				"after a clock skip, PrismaLens's own timers fire late and exactly once",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
});
