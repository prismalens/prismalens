// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";
import type { SurfaceId } from "@/components/kit/actions";
import type { CategoryId } from "./category";

interface Walk {
	title: string;
	/** The categories a judge scores this walk on. */
	categories: readonly CategoryId[];
	/** The registered surfaces the walk visits: a walk case covers each for its conditions. */
	surfaces: readonly SurfaceId[];
	/** Who asked for the walk, when and in what words; the bar's own walks carry its row. */
	said?: { date: string; quote: string; where: string };
}

const bar = (quote: string) =>
	({ date: "2026-11-12", quote, where: "#1101 bar" }) as const;

const NEW_WALKS = {
	date: "2026-11-13",
	quote:
		"organizer, checkpoint 4 order, from the operator's Interrupted/Blocked and huge-diff requirements",
	where: "#1101 bar",
} as const;

/** #1101's task walks; each passes at 8.5 on every category it touches. */
export const walks = defineClosed(
	"walk",
	[
		"attach",
		"quote-new-thread",
		"answer-ask",
		"resume-limit",
		"find-pr-checks",
		"agent-starts-thread",
		"settle-thread",
		"restart-resume",
		"blocked-fix",
		"review-huge-diff",
	] as const,
	{
		attach: {
			title: "Attach a file",
			categories: ["7", "6", "5"],
			surfaces: ["attachment.chip", "thread.header"],
			said: bar("Attach a file | 7 chips, 6 composer, 5 phone"),
		},
		"quote-new-thread": {
			title: "Quote a selection into a new thread",
			categories: ["7", "20", "10", "1"],
			surfaces: ["message", "thread.header", "thread.row", "attachment.chip"],
			said: bar(
				"Quote a selection into a new thread | 7 chips, 20 thread menu (side question / fork), 10 messages between threads, 1 list",
			),
		},
		"answer-ask": {
			title: "Answer an ask from the dock",
			categories: ["8", "2", "4", "5"],
			surfaces: ["decision", "thread.row", "needs.card"],
			said: bar(
				"Answer an ask from the dock | 8 asks, 2 statuses, 4 notifications, 5 phone",
			),
		},
		"resume-limit": {
			title: "Resume after a limit",
			categories: ["17", "2", "14", "3", "23"],
			surfaces: ["message", "thread.row", "needs.card", "transcript.unseen"],
			said: bar(
				"Resume after a limit | 17 limits, 2 statuses, 14 rail mark, 3 away, 23 notices",
			),
		},
		"find-pr-checks": {
			title: "Find a PR's checks",
			categories: ["15", "1", "19"],
			surfaces: ["pr.chip", "check.row", "thread.row", "thread.result"],
			said: bar(
				"Find a PR's checks | 15 PR, 1 list (PR tone on the row), 19 palette",
			),
		},
		"agent-starts-thread": {
			title:
				"An agent starts a sibling thread, messages it, and the sibling finishes",
			categories: ["10", "9", "1", "2"],
			surfaces: ["tool.row", "thread.row", "message", "thread.header"],
			said: bar(
				"Watch an agent start a thread that reports back by message | 10 threads and messages, 9 tool rows, 1 list, 2 statuses",
			),
		},
		"settle-thread": {
			title: "Settle a finished thread",
			categories: ["20", "2"],
			surfaces: ["thread.row", "thread.header"],
		},
		"restart-resume": {
			title:
				"A thread restarted mid-run reads Interrupted, offers Resume, and resumes once",
			categories: ["23", "17", "12", "14", "2"],
			surfaces: ["thread.row", "thread.header", "message", "transcript.unseen"],
			said: NEW_WALKS,
		},
		"blocked-fix": {
			title:
				"Blocked by a full disk and by a rejected key, each offering its own fix from the thread, the row and Home",
			categories: ["2", "17", "23", "4"],
			surfaces: ["thread.row", "thread.header", "needs.card", "message"],
			said: NEW_WALKS,
		},
		"review-huge-diff": {
			title:
				"Review a huge diff (about 870 files): the tree before any patch, lazy patches, folding, group filters, no freeze",
			categories: ["16", "15", "12", "21"],
			surfaces: ["diff.tree", "diff.file", "diff.line", "pane.tab", "pr.chip"],
			said: NEW_WALKS,
		},
	} satisfies Record<string, Walk>,
);

export type WalkId = (typeof walks.members)[number];
