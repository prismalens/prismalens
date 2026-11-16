// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

interface Said {
	date: string;
	quote: string;
	where: string;
}

interface Rule {
	title: string;
	/** What the organizer does with the judges' scores; `judge-pack` writes it into the kit. */
	text: string;
	said: Said;
}

const SCORES = {
	date: "2026-11-14",
	quote:
		"three judges score each checkpoint from the same prompt: Codex, Opus and agy",
	where: "#1101 Scores",
} as const;

/** How a checkpoint's scores are merged and when the climb stops (#1101 Scores). */
export const judgeRules = defineClosed(
	"judgeRule",
	["merge", "stop"] as const,
	{
		merge: {
			title: "Merge rule",
			text: "A category's score is the median of the three judges (Codex, Opus and agy), after calibration. Every flaw below 8.5 that a judge backs with a screenshot goes on the fix list, whatever the median. A cell without a valid stamp is not tested: its categories are null.",
			said: SCORES,
		},
		stop: {
			title: "Stop rule",
			text: "The bar is met only when every category is at 8.5 or above on two checkpoints in a row.",
			said: SCORES,
		},
	} satisfies Record<string, Rule>,
);

interface FalseAlarm {
	/** What a judge sees that is not a product fault, and why. */
	text: string;
	said: Said;
}

const ROUND1 = {
	date: "2026-11-05",
	quote:
		"notes for known false alarms: fixture text, phone chips scroll by design, ERR_INSUFFICIENT_RESOURCES = browser under load",
	where: "hill climb 1 scoring prompt",
} as const;

/** What judges keep flagging that is not a product fault; every judge prompt lists them. */
export const falseAlarms = defineClosed(
	"falseAlarm",
	[
		"fixture-text",
		"phone-chips-scroll",
		"browser-under-load",
		"away-once",
		"shared-server",
		"server-clock-ahead",
	] as const,
	{
		"fixture-text": {
			text: "Thread titles, replies and file contents are seeded fixtures or fake agents replaying recorded sessions. Don't score their wording, only the product's own words.",
			said: ROUND1,
		},
		"phone-chips-scroll": {
			text: "At 390 px the chip rows scroll sideways inside their own strip on purpose; the page itself must not scroll sideways (measures.md counts that).",
			said: ROUND1,
		},
		"browser-under-load": {
			text: "ERR_INSUFFICIENT_RESOURCES and 'Failed to fetch dynamically imported module' come from a browser under load on the shared machine, not from the app; reload once and note it.",
			said: ROUND1,
		},
		"away-once": {
			text: "The away view opens on the first visible tab after a long absence, once; a later visit, or another judge's visit first, finds it spent. Its shot is in the evidence folder.",
			said: {
				date: "2026-11-05",
				quote:
					"only first visit after being away shows it, so 768/390 Home shots lack it",
				where: "hill climb 1 scoring prompt",
			},
		},
		"shared-server": {
			text: "Drafts follow the operator across devices by design: on a server shared with another judge, Home's draft changes under you. Each judge runs on their own sim; a thread's state changing under you means another walk on the same thread, so use another thread of the same kind and note it.",
			said: {
				date: "2026-11-14",
				quote: "judges sharing a server wrote into each other's Home draft",
				where: "checkpoint 4 judge reports",
			},
		},
		"server-clock-ahead": {
			text: "host.standby proves itself by skipping the server's clock 11 minutes, as a laptop's sleep does, so on a sim a time near now can read a few minutes in the future (\"in 2m\"). Score the time format, not that offset.",
			said: {
				date: "2026-11-14",
				quote:
					"Watch the rollout ... in 2m (Events, a simulated PrismaLens after its standby skip)",
				where: "checkpoint 5 tooling run",
			},
		},
	} satisfies Record<string, FalseAlarm>,
);

export type JudgeRuleId = (typeof judgeRules.members)[number];
export type FalseAlarmId = (typeof falseAlarms.members)[number];
