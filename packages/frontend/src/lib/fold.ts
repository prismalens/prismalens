// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EVENT_FOLD, type FoldClass } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import { formatClock, formatDayClock } from "./format-time";
import type { OperatorState, TranscriptItem } from "./investigation-events";

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
	operator: {
		class: "own",
		why: "Your message: folds past about 6 lines. The note PrismaLens sends on Resume is work: one restart line until opened.",
	},
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
	restart?: unknown;
}): FoldClass {
	if (item.kind === "operator" && item.restart) return "work";
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

/** Where a piece of a message's meta shows (#1101 operator review, 2026-11-15). */
export type MetaPlace = "shown" | "hover";

/**
 * Who sent a message, and whether that is obvious. The obvious sender's name, and every
 * time, show on hover or focus in the gap beside the message; a tap shows them on the phone.
 */
export type MetaSender = "you" | "thread" | "trigger";

export const META_SENDER = defineClosed(
	"metaSender",
	["you", "thread", "trigger"] as const,
	{
		you: { place: "hover", why: "Your own message: the bubble says who." },
		thread: { place: "shown", why: "Another thread or agent wrote it." },
		trigger: { place: "shown", why: "An alert, schedule or webhook sent it." },
	} as Record<MetaSender, { place: MetaPlace; why: string }>,
);

/**
 * A message's delivery verb: settled ones go in the hover, one still pending or failed
 * stays in view, because it asks you to wait or act.
 */
export const META_STATE = defineClosed(
	"metaState",
	[
		"started",
		"resumed",
		"asked",
		"queued",
		"sent_now",
		"delivered",
		"answered",
		"not_delivered",
	] as const satisfies readonly OperatorState[],
	{
		started: "hover",
		resumed: "hover",
		asked: "hover",
		queued: "shown",
		sent_now: "hover",
		delivered: "hover",
		answered: "hover",
		not_delivered: "shown",
	} as Record<OperatorState, MetaPlace>,
);

/** Status rows that carry no decision; each joins a neighbour's hover instead of its own row. */
export const META_ROW = defineClosed(
	"metaRow",
	["resumed", "responseActions"] as const,
	{
		resumed: {
			place: "hover",
			why: "'Resumed in the same session' joins the next message's meta.",
		},
		responseActions: {
			place: "hover",
			why: "Copy and Fork stay in view on the latest response; earlier ones show on hover or focus.",
		},
	} as Record<"resumed" | "responseActions", { place: MetaPlace; why: string }>,
);

/** A quiet time divider goes before the first message after this long a silence, or on a new day. */
export const TIME_BREAK_MIN = 60;

/** The time divider's label before `at`, or null when it follows `prev` closely on the same day. */
export function timeBreak(
	prev: string | undefined,
	at: string | undefined,
	now: number,
): string | null {
	if (!prev || !at) return null;
	const a = new Date(prev);
	const b = new Date(at);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
	const newDay = a.toDateString() !== b.toDateString();
	if (!newDay && b.getTime() - a.getTime() < TIME_BREAK_MIN * 60_000)
		return null;
	const today = new Date(now);
	const yesterday = new Date(now - 86_400_000);
	const day =
		b.toDateString() === today.toDateString()
			? "Today "
			: b.toDateString() === yesterday.toDateString()
				? "Yesterday "
				: "";
	return day ? `${day}${formatClock(b)}` : formatDayClock(b, now);
}

/**
 * An opened fold taller than this share of the visible transcript scrolls in place at that
 * height, so the rows around it hold still; "Open all" lifts the cap (#1101 cat 12 item 6).
 */
export const UNFOLD_AREA_SHARE = 0.5;
