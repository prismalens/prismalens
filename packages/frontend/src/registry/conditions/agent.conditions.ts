// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const agentRunaway = define.condition({
	id: "agent.runaway",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list (a runaway agent among it) at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["agent-starts-thread"], categories: ["9", "12", "23"] },
	simulator: "fake.runaway",
	profile: { session: "runaway", callsPerS: 10 },
	measure: [
		{
			state:
				"every tool call is stored, the page stays responsive at 390 px, and Stop ends the turn at once",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/conditions/session-condition.mjs agent.runaway --url {url}",
		live: "the thread Fix the flaky retry test, stopped after 20 s of the same call ten times a second",
	},
});

export const agentMessageLoop = define.condition({
	id: "agent.message-loop",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"Two threads messaging in a loop: the pair cap stops it with a notice",
		where: "#1101, Simulated conditions (bar text; no operator quote found)",
	},
	appliesTo: { walks: ["agent-starts-thread"], categories: ["10", "23", "17"] },
	simulator: "fake.message-loop",
	profile: { session: "message-loop" },
	measure: [
		{ state: "the pair cap stops the loop and the thread shows a notice" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs message-loop --url {url} --stamp agent.message-loop",
		live: "the thread the message-loop alert opens; the pair cap stops it with a notice",
	},
});

export const agentStalled = define.condition({
	id: "agent.stalled",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			'Stalled thread | 2, 9, 4 | "Working, quiet for N min", what the running row is doing, a notification',
		where: "#1101 bar",
	},
	appliesTo: { walks: ["agent-starts-thread"], categories: ["2", "9", "4"] },
	simulator: "fake.failure-case",
	profile: { case: "live-stuck" },
	measure: [
		{
			state:
				"Working, quiet for N min, the running row says what it is doing, and a notification fires",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs live-stuck --url {url} --stamp agent.stalled",
		live: "the thread the live-stuck alert opens, Working and quiet",
	},
});
