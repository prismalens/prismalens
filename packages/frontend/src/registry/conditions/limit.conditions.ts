// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const limitMidTurn = define.condition({
	id: "limit.mid-turn",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"Usage limit mid-turn: partial turn kept, the reset time, auto-resume once, a rail mark",
		where: "#1101, Simulated conditions",
	},
	appliesTo: {
		walks: ["resume-limit"],
		categories: ["17", "2", "14", "23", "4"],
	},
	simulator: "fake.failure-case",
	profile: { case: "limit-mid-turn" },
	measure: [
		{
			state:
				"the partial turn kept, Limited with the reset time, one auto-resume, a rail mark",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs limit-mid-turn --url {url}",
		live: "the thread the limit-mid-turn alert opens, Limited with its reset time",
	},
});
