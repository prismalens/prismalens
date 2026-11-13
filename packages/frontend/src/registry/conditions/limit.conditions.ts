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

export const limitRateLimited = define.condition({
	id: "limit.rate-limited",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"↳ variants: a 429 with retry-after, out of credit, an invalid or revoked key, an org spend cap, provider overloaded | 17, 2, 14, 23 | The table in 17. Each runs as a recorded-agent case carrying status, type, code and retry-after, and again across a restart",
		where: "#1101 bar",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["17", "2", "14", "23"] },
	simulator: "fake.failure-case",
	profile: { cases: ["api-rate-limit", "api-rate-limit-short"] },
	measure: [
		{
			state:
				"a 429 with retry-after 90 s is Limited, trying again at the time, try 2 of 5; with retry-after 1 s it is waited out inside the turn",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs api-rate-limit --url {url} && node scripts/fakes/failure-case.mjs api-rate-limit-short --url {url}",
		live: "the two threads the api-rate-limit and api-rate-limit-short alerts open",
	},
});

export const limitOutOfCredit = define.condition({
	id: "limit.out-of-credit",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"↳ variants: a 429 with retry-after, out of credit, an invalid or revoked key, an org spend cap, provider overloaded | 17, 2, 14, 23 | The table in 17. Each runs as a recorded-agent case carrying status, type, code and retry-after, and again across a restart",
		where: "#1101 bar",
	},
	appliesTo: {
		walks: ["resume-limit", "blocked-fix"],
		categories: ["17", "2", "14", "23"],
	},
	simulator: "fake.failure-case",
	profile: { case: "api-credit" },
	measure: [
		{ state: "Blocked with Add credit and Switch agent, and no timer" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs api-credit --url {url}",
		live: "the thread the api-credit alert opens, Blocked",
	},
});

export const limitOverloaded = define.condition({
	id: "limit.overloaded",
	group: "real-life",
	said: {
		date: "2026-11-12",
		quote:
			"↳ variants: a 429 with retry-after, out of credit, an invalid or revoked key, an org spend cap, provider overloaded | 17, 2, 14, 23 | The table in 17. Each runs as a recorded-agent case carrying status, type, code and retry-after, and again across a restart",
		where: "#1101 bar",
	},
	appliesTo: { walks: ["resume-limit"], categories: ["17", "2", "14", "23"] },
	simulator: "fake.failure-case",
	profile: { cases: ["api-overloaded", "api-overloaded-gave-up"] },
	measure: [
		{
			state:
				"a busy provider is retried inside the turn; after five busy tries the thread needs you, with Retry now",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
	stage: {
		run: "node scripts/fakes/failure-case.mjs api-overloaded --url {url} && node scripts/fakes/failure-case.mjs api-overloaded-gave-up --url {url}",
		live: "the two threads the api-overloaded and api-overloaded-gave-up alerts open",
	},
});
