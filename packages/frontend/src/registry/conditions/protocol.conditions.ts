// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const protocolDrift = define.condition({
	id: "protocol.drift",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: "all", categories: ["23"] },
	simulator: "fake.protocol-drift",
	profile: {
		session: "protocol-drift",
		versionAhead: 1,
	},
	stage: {
		run: "node scripts/fakes/conditions/session-condition.mjs protocol.drift --url {url}",
		live: "the thread Checkout 502s from an agent a protocol version ahead",
	},
	measure: [
		{
			state:
				"an unknown agent version is a non-blocking notice on the agent and the thread; each unknown update kind is a plain row, never dropped",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});
