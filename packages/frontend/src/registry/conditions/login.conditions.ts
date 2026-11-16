// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const loginExpired = define.condition({
	id: "login.expired",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote: "an invalid or revoked key",
		where:
			"#1101, Simulated conditions, usage-limit variants (bar text; no operator quote found)",
	},
	appliesTo: {
		walks: ["resume-limit", "blocked-fix"],
		categories: ["17", "23", "2", "14"],
	},
	simulator: "fake.failure-case",
	profile: { cases: ["api-key-rejected", "not-signed-in"] },
	measure: [
		{
			state:
				"a rejected key is Blocked with Update key and Switch agent, never a sign-in prompt; a signed-out agent stops and says so",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs api-key-rejected not-signed-in --url {url} --stamp login.expired",
		live: "the two threads the api-key-rejected and not-signed-in alerts open",
	},
});
