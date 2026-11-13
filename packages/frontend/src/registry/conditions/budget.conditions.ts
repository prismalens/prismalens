// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const budgetCap = define.condition({
	id: "budget.cap",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote: "an org spend cap",
		where:
			"#1101, Simulated conditions, usage-limit variants (bar text; no operator quote found)",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["17", "23"] },
	simulator: "fake.budget-cap",
	profile: {
		session: "budget-cap",
		costUsd: 5,
	},
	stage: {
		run: "node scripts/fakes/conditions/session-condition.mjs budget.cap --url {url}",
		live: "the thread Why are checkouts failing, stopped at its $5 budget",
	},
	measure: [
		{ state: "Blocked with Raise the cap and Switch agent, and no timer" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});
