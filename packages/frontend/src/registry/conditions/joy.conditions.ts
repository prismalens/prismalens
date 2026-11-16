// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const joyNoGamification = define.condition({
	id: "joy.no-gamification",
	group: "product",
	said: {
		date: "2026-11-04",
		quote: "game-feel without gamification",
		where:
			"organizer relay of the operator, 2026-11-04 (ui-reset PROMPT.md); verbatim unconfirmed",
	},
	appliesTo: { walks: [], categories: [] },
	simulator: "unbuilt",
	profile: {},
	measure: [{ state: "no streaks, points or badges; ease and flow only" }],
	verdict: "reviewed",
	ci: { debt: "climb" },
	status: "parked",
});
