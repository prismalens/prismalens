// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const threadsMany = define.condition({
	id: "threads.many",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"More than 10 threads | 1, 2, 19, 4 | The needs-you count, the started-by filter, the palette filters, and that no alert fires on agent-started finishes",
		where: "#1101 bar",
	},
	appliesTo: {
		walks: ["find-pr-checks", "agent-starts-thread"],
		categories: ["1", "2", "19", "4"],
	},
	simulator: "seed.thread-list",
	profile: { threads: 40, startedByAgents: 12 },
	measure: [
		{
			state:
				"the needs-you count, the started-by filter and the palette filters hold, and no alert fires on agent-started finishes",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "pnpm --filter @prismalens/api seed:thread-list --stamp",
		live: "the list with 40 more threads in every status, 12 started by agents (the started-by filter), asks waiting in several",
	},
});
