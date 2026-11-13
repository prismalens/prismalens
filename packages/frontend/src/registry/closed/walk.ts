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
}

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
	] as const,
	{
		attach: {
			title: "Attach a file",
			categories: ["7", "6", "5"],
			surfaces: ["attachment.chip", "thread.header"],
		},
		"quote-new-thread": {
			title: "Quote a selection into a new thread",
			categories: ["7", "20", "10", "1"],
			surfaces: ["message", "thread.header", "thread.row", "attachment.chip"],
		},
		"answer-ask": {
			title: "Answer an ask from the dock",
			categories: ["8", "2", "4", "5"],
			surfaces: ["decision", "thread.row", "needs.card"],
		},
		"resume-limit": {
			title: "Resume after a limit",
			categories: ["17", "2", "14", "3", "23"],
			surfaces: ["message", "thread.row", "needs.card", "transcript.unseen"],
		},
		"find-pr-checks": {
			title: "Find a PR's checks",
			categories: ["15", "1", "19"],
			surfaces: ["pr.chip", "check.row", "thread.row", "thread.result"],
		},
		"agent-starts-thread": {
			title: "Watch an agent start a thread that reports back by message",
			categories: ["10", "9", "1", "2"],
			surfaces: ["child.card", "subagent.node", "tool.row", "thread.row"],
		},
		"settle-thread": {
			title: "Settle a finished thread",
			categories: ["20", "2"],
			surfaces: ["thread.row", "thread.header"],
		},
	} satisfies Record<string, Walk>,
);

export type WalkId = (typeof walks.members)[number];
