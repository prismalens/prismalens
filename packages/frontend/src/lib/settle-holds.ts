// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What a thread can hold that Settle ends (#1101 category 20, the settle.cleanup
 * condition): one entry per field of the server's settle preview, so a new kind of
 * hold fails the type check until it has its icon and words here.
 */
import type { SettlePreview } from "@prismalens/contracts";
import {
	AlarmClock,
	Bot,
	CalendarClock,
	Eye,
	FolderGit2,
	type LucideIcon,
} from "lucide-react";

export type SettleHold = keyof SettlePreview;

export interface SettleHoldView {
	Icon: LucideIcon;
	one: string;
	many: string;
}

export const SETTLE_HOLDS: Readonly<Record<SettleHold, SettleHoldView>> = {
	running: { Icon: Bot, one: "running agent", many: "running agents" },
	watches: { Icon: Eye, one: "watch", many: "watches" },
	crons: { Icon: CalendarClock, one: "schedule", many: "schedules" },
	wakes: { Icon: AlarmClock, one: "wake", many: "wakes" },
	worktrees: { Icon: FolderGit2, one: "worktree", many: "worktrees" },
};

/** How many of each hold Settle ends; a worktree with work in it is kept, so it is not counted. */
export function holdCount(p: SettlePreview, hold: SettleHold): number {
	return hold === "worktrees"
		? p.worktrees.filter((w) => w.action === "remove").length
		: p[hold];
}

export const holdWords = (hold: SettleHold, n: number) =>
	`${n} ${n === 1 ? SETTLE_HOLDS[hold].one : SETTLE_HOLDS[hold].many}`;

/** Settle ends nothing and keeps no worktree, so it needs no confirm: it lands at once with Undo. */
export const endsNothing = (p: SettlePreview): boolean =>
	(Object.keys(SETTLE_HOLDS) as SettleHold[]).every(
		(h) => holdCount(p, h) === 0,
	) && !p.worktrees.some((w) => w.action === "keep");

/** "Ends 2 watches and 1 schedule", or "Nothing else to end". */
export function settleEndsLine(p: SettlePreview): string {
	const parts = (Object.keys(SETTLE_HOLDS) as SettleHold[]).flatMap((h) => {
		const n = holdCount(p, h);
		return n ? [holdWords(h, n)] : [];
	});
	if (!parts.length) return "Nothing else to end";
	const last = parts.pop();
	return `Ends ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
}
