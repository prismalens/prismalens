// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EVENT_FOLD, type FoldClass } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import type { TranscriptItem } from "./investigation-events";

/** How one transcript item kind folds (#1101 category 12 item 6). */
export interface FoldView {
	class: FoldClass;
	/** The nested level a `work` item folds at: inside the turn's steps, or as an item of them. */
	level?: "steps" | "item";
	/** Why it is classed so, for the manifest and an agent reading it. */
	why: string;
}

const VIEWS: Record<TranscriptItem["kind"], FoldView> = {
	prose: {
		class: "work",
		level: "steps",
		why: "Narration between steps; the turn's last words and the last before an ask or stop are read.",
	},
	ask: { class: "read", why: "An ask waits on you: never hidden." },
	line: { class: "read", why: "A notice the run said once." },
	choice: { class: "read", why: "Your answer to a question." },
	level: {
		class: "work",
		level: "item",
		why: "A call the run's level answered without asking.",
	},
	tools: { class: "work", level: "item", why: "Tool rows and their output." },
	finding: {
		class: "work",
		level: "item",
		why: "Evidence or a suspect recorded mid-turn.",
	},
	gateway: { class: "work", level: "item", why: "A PrismaLens tool call." },
	thought: { class: "work", level: "item", why: "Thinking time." },
	subagent: { class: "work", level: "item", why: "A sub-agent's steps." },
	artifact: { class: "read", why: "A page the agent published." },
	divider: { class: "read", why: "Compaction, restart and resume notices." },
	thinking: { class: "read", why: "The live working line." },
	operator: { class: "own", why: "Your message: folds past about 6 lines." },
	end: { class: "read", why: "How the run ended: report, stop or limit." },
	empty: { class: "read", why: "Nothing yet." },
	node: {
		class: "read",
		why: "An event a lane draws; its own class comes from EVENT_FOLD.",
	},
	inbound: {
		class: "thread",
		why: "A message from another thread or source: its sender and 3 lines.",
	},
	outcome: {
		class: "read",
		why: "What became of a call you approved or denied.",
	},
};

/** Every transcript item kind's fold class; a new kind fails typecheck until it has one. */
export const FOLD = defineClosed(
	"fold",
	Object.keys(VIEWS) as TranscriptItem["kind"][],
	VIEWS,
);

/**
 * An item's class; a lane-drawn event takes its event kind's class. An unknown kind
 * reads as `read`: what the registry cannot class is never hidden.
 */
export function foldClassOf(item: {
	kind: string;
	event?: { kind: string };
}): FoldClass {
	if (item.kind === "node" && item.event)
		return (
			(EVENT_FOLD as Record<string, FoldClass | undefined>)[item.event.kind] ??
			"read"
		);
	return Object.hasOwn(VIEWS, item.kind)
		? VIEWS[item.kind as TranscriptItem["kind"]].class
		: "read";
}

/** Lines your own message shows before Show more. */
export const OWN_LINES = 6;
/** Lines a message from another thread shows before Show more. */
export const THREAD_LINES = 3;
/** A code block, log or table in a read item longer than this shows its head. */
export const READ_BLOCK_OVER = 30;
export const READ_BLOCK_HEAD = 12;
