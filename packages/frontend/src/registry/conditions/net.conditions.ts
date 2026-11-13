// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const slowLink = define.condition({
	id: "net.slow-link",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote:
			"A spoty mobile internet. And with that criteria, they fixed and optimised anything that takes time",
		where: "operator, organizer session, 2026-11-11 15:35Z",
	},
	appliesTo: { walks: "all", categories: ["12", "5", "23"] },
	simulator: "net.throttle",
	profile: {
		rttMs: 400,
		downKbps: 1600,
		upKbps: 750,
		cpu: 4,
		drops: [{ atS: "mid", forS: 10 }],
	},
	measure: [
		{ metric: "thread.firstContent", max: 3000, unit: "ms" },
		{ metric: "bytes.beforeFirstPaint", max: 500000, unit: "B" },
		{ metric: "connection.wordAfterDrop", max: 2000, unit: "ms" },
		{ state: "the connection word shows, no reload, the draft kept" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
	pairsWith: ["huge.diff"],
});
