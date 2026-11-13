// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const agentRunaway = define.condition({
	id: "agent.runaway",
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
		run: "node scripts/fakes/failure-case.mjs message-loop --url {url}",
		live: "the thread the message-loop alert opens; the pair cap stops it with a notice",
	},
});
