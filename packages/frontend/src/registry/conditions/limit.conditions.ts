// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const limitMidTurn = define.condition({
	id: "limit.mid-turn",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"a limit never fails the thread or drops a message: messages that arrive during it are queued and delivered on resume, and each one shows that it's waiting",
		where:
			"operator, organizer session, 2026-11-12 08:00Z; also 2026-11-11 15:44Z, don't actually hit the limit to test it",
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
		run: "node scripts/fakes/failure-case.mjs limit-mid-turn --url {url} --stamp limit.mid-turn",
		live: "the thread the limit-mid-turn alert opens, Limited with its reset time",
	},
});
