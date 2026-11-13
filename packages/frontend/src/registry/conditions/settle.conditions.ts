// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const settleCleanup = define.condition({
	id: "settle.cleanup",
	group: "product",
	said: {
		date: "2026-11-11",
		quote:
			"what about clearing things up automatically when a thread is settled or marked done",
		where:
			"operator, organizer session, 2026-11-11 08:40Z; also 2026-11-10 10:12Z, many node.exe left running",
	},
	appliesTo: { walks: [], categories: ["2", "20"] },
	simulator: "unbuilt",
	profile: {},
	measure: [
		{
			state:
				"after a settle with a watch, a cron, a worktree and a child process, none remain",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
});
