// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const hugeDiff = define.condition({
	id: "huge.diff",
	group: "real-life",
	said: {
		date: "2026-11-13",
		quote:
			"when I tried to open this PR in browser, even on 5g my browser hung for sometime",
		where: "operator, organizer session, 2026-11-13 09:14Z, on PR #1129",
	},
	appliesTo: {
		walks: ["find-pr-checks"],
		categories: ["16", "15", "12", "21"],
	},
	simulator: "seed.huge-diff",
	profile: { files: 870 },
	measure: [
		{ metric: "bytes.beforeFirstFile", max: 1000000, unit: "B" },
		{ metric: "mainThread.longestTask", max: 200, unit: "ms" },
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "parked",
	pairsWith: ["net.slow-link"],
});

export const hugeLog = define.condition({
	id: "huge.log",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["agent-starts-thread"], categories: ["9", "12"] },
	simulator: "seed.huge-output",
	profile: {
		replyLines: 50000,
		toolResults: 200,
		previewChars: 4000,
	},
	stage: {
		run: "pnpm --filter @prismalens/api seed:huge-output log",
		live: "the thread Huge log in a reply",
	},
	measure: [
		{
			state:
				"a tool row with a huge output stays collapsed, scrolls and copies without freezing the page",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});

export const hugePaste = define.condition({
	id: "huge.paste",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["attach"], categories: ["7", "6"] },
	simulator: "seed.huge-output",
	profile: {
		messageChars: 4000,
		pasteBytes: 3145728,
	},
	stage: {
		run: "pnpm --filter @prismalens/api seed:huge-output paste",
		live: "the thread Huge paste",
	},
	measure: [
		{
			state:
				"a huge paste in the composer becomes a chip or a file, and typing stays responsive",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});

export const hugeBinary = define.condition({
	id: "huge.binary",
	group: "real-life",
	said: {
		date: "2026-11-11",
		quote: "What other such real life behaviours should we consider?",
		where:
			"operator asked at 15:36Z and accepted the organizer's list at 15:41Z (organizer session); also #1101, Simulated conditions",
	},
	appliesTo: { walks: ["attach"], categories: ["7", "16"] },
	simulator: "seed.huge-output",
	profile: {
		previewChars: 4000,
		fileBytes: 20971520,
	},
	stage: {
		run: "pnpm --filter @prismalens/api seed:huge-output binary",
		live: "the thread Huge binary output",
	},
	measure: [
		{
			state:
				"a binary or oversized file is named and refused or summarised, never rendered as text",
		},
	],
	verdict: "both",
	ci: { debt: "climb" },
	status: "active",
});
